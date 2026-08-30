import { DurableObject } from 'cloudflare:workers';
import {
  eligibleVoters,
  hasFilledAll,
  normalise,
  pickLetter,
  resolveProtest,
  sanitiseSettings,
  scoreRound,
} from './game';
import {
  DEFAULT_SETTINGS,
  MAX_ANSWER_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  PROTEST_VOTE_SECONDS,
  overrideKey,
  type Player,
  type RoomState,
} from './types';

interface Attachment {
  playerId: string;
}

interface RoomEnv {
  DICTIONARY: DurableObjectNamespace;
}

/**
 * One Durable Object per room. Holds the authoritative game state.
 *
 * Uses the WebSocket Hibernation API, so the object can be evicted between
 * messages without dropping sockets. That means state lives in storage rather
 * than instance fields; `cache` is only a within-invocation memo, never the
 * source of truth.
 */
export class Room extends DurableObject<RoomEnv> {
  private cache: RoomState | null = null;

  /** Community words for the categories in play, refreshed each scoring pass. */
  /**
   * Ask the dictionary about this round's answers, and nothing else.
   *
   * The obvious implementation pulls each category's whole word list and builds
   * a Set. That means moving several hundred thousand words per round to judge
   * at most a hundred and sixty answers. Instead the distinct answers actually
   * played are sent over and the valid ones come back, so the payload scales
   * with the table rather than the dictionary.
   *
   * The return shape is still Record<category, Set<word>>, so scoreRound is
   * unchanged: it simply receives a set containing only this round's winners.
   */
  private async validateAnswers(
    state: RoomState
  ): Promise<Record<string, Set<string>>> {
    const pairs: { category: string; word: string }[] = [];
    const seen = new Set<string>();

    for (const category of state.settings.categories) {
      for (const p of state.players) {
        const word = normalise(state.answers[p.id]?.[category] ?? '');
        if (!word) continue;
        const key = `${category}::${word}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ category, word });
      }
    }
    if (pairs.length === 0) return {};

    try {
      const stub = this.env.DICTIONARY.get(this.env.DICTIONARY.idFromName('global'));
      const res = await stub.fetch('https://dict/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pairs),
      });
      const { valid, covered } = (await res.json()) as {
        valid: { category: string; word: string }[];
        covered: string[];
      };

      /*
        Every covered category gets an entry, even an empty one. An absent key
        means "no dictionary for this category, accept on the letter rule"; an
        empty set means "there is a dictionary and none of these answers were
        in it, reject them". Collapsing the two would accept a whole round of
        nonsense whenever nothing happened to match.
      */
      const out: Record<string, Set<string>> = {};
      for (const c of covered ?? []) out[c] = new Set();
      for (const v of valid) (out[v.category] ??= new Set()).add(v.word);
      return out;
    } catch {
      // A dictionary outage must not stop a game. Returning nothing means
      // scoreRound falls back to the letter rule, which is the pre-dictionary
      // behaviour rather than rejecting everything.
      return {};
    }
  }

  private async load(): Promise<RoomState | null> {
    if (this.cache) return this.cache;
    const s = await this.ctx.storage.get<RoomState>('state');
    this.cache = s ?? null;
    return this.cache;
  }

  private async save(state: RoomState): Promise<void> {
    this.cache = state;
    await this.ctx.storage.put('state', state);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/exists')) {
      const state = await this.load();
      return Response.json({ exists: !!state, players: state?.players.length ?? 0 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    const code = (url.searchParams.get('code') ?? '').toUpperCase();
    const name = (url.searchParams.get('name') ?? 'player').slice(0, MAX_NAME_LENGTH);
    const create = url.searchParams.get('create') === '1';
    const playerId = crypto.randomUUID();

    let state = await this.load();

    if (!state) {
      if (!create) {
        return new Response('no such room', { status: 404 });
      }
      state = {
        code,
        hostId: playerId,
        phase: 'lobby',
        settings: { ...DEFAULT_SETTINGS },
        players: [],
        round: 0,
        letter: null,
        usedLetters: [],
        answers: {},
        deadline: null,
        graceTriggeredBy: null,
        results: [],
        createdAt: Date.now(),
        overrides: [],
        protest: null,
        protestedThisRound: [],
      };
    }

    if (state.players.length >= MAX_PLAYERS) {
      return new Response('room full', { status: 409 });
    }
    // Joining mid-game would have no answer sheet and no score history, so
    // late arrivals wait for the lobby between games.
    if (state.phase !== 'lobby' && state.phase !== 'finished') {
      return new Response('game in progress', { status: 409 });
    }

    const taken = new Set(state.players.map((p) => p.name.toLowerCase()));
    let finalName = name.trim() || 'player';
    let n = 2;
    while (taken.has(finalName.toLowerCase())) finalName = `${name} ${n++}`;

    state.players.push({
      id: playerId,
      name: finalName,
      connected: true,
      score: 0,
      submittedRound: -1,
    });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId } satisfies Attachment);

    await this.save(state);
    this.broadcast(state);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;

    const state = await this.load();
    if (!state) return;

    const att = ws.deserializeAttachment() as Attachment | null;
    const me = state.players.find((p) => p.id === att?.playerId);
    if (!me) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const isHost = me.id === state.hostId;

    switch (msg.type) {
      case 'settings': {
        if (!isHost || state.phase !== 'lobby') return;
        state.settings = sanitiseSettings(
          (msg.settings ?? {}) as Record<string, never>,
          state.settings
        );
        break;
      }

      case 'start': {
        if (!isHost) return;
        if (state.phase !== 'lobby' && state.phase !== 'finished') return;
        if (state.phase === 'finished') {
          // Rematch: keep the room and the people, reset the game.
          state.round = 0;
          state.results = [];
          state.usedLetters = [];
          for (const p of state.players) p.score = 0;
        }
        await this.beginRound(state);
        break;
      }

      case 'answer': {
        if (state.phase !== 'writing') return;
        if (me.submittedRound === state.round) return;
        const category = String(msg.category ?? '');
        if (!state.settings.categories.includes(category)) return;
        const value = String(msg.value ?? '').slice(0, MAX_ANSWER_LENGTH);
        state.answers[me.id] = state.answers[me.id] ?? {};
        state.answers[me.id][category] = value;
        // Keystrokes are frequent; persist without a full broadcast so we do
        // not echo every character to nine other clients.
        await this.save(state);
        this.broadcastProgress(state);
        return;
      }

      case 'submit': {
        if (state.phase !== 'writing') return;
        if (me.submittedRound === state.round) return;
        me.submittedRound = state.round;

        const everyone = state.players.filter((p) => p.connected);
        const allIn = everyone.every((p) => p.submittedRound === state.round);

        if (allIn) {
          await this.endRound(state);
          break;
        }

        // First finisher opens the grace window, if one is configured and the
        // player genuinely completed the sheet.
        const complete = hasFilledAll(me.id, state.answers, state.settings);
        if (!state.graceTriggeredBy && complete && state.settings.graceSeconds > 0) {
          state.graceTriggeredBy = me.id;
          const graceEnd = Date.now() + state.settings.graceSeconds * 1000;
          // Never extend a round beyond its own hard deadline.
          state.deadline = Math.min(state.deadline ?? graceEnd, graceEnd);
          await this.ctx.storage.setAlarm(state.deadline);
        }
        break;
      }

      case 'kick': {
        if (!isHost) return;
        const targetId = String(msg.playerId ?? '');
        if (targetId === state.hostId) return;
        state.players = state.players.filter((p) => p.id !== targetId);
        delete state.answers[targetId];
        for (const sock of this.ctx.getWebSockets()) {
          const a = sock.deserializeAttachment() as Attachment | null;
          if (a?.playerId === targetId) sock.close(4000, 'removed by host');
        }
        break;
      }

      case 'protest': {
        if (state.phase !== 'review' || state.protest) return;
        const category = String(msg.category ?? '');
        const key = overrideKey(me.id, category);

        // One protest per answer per round, and only for your own rejection.
        if (state.protestedThisRound.includes(key)) return;
        const last = state.results[state.results.length - 1];
        const cell = last?.breakdown[me.id]?.[category];
        if (!cell || cell.verdict !== 'invalid') return;

        // A vote needs someone to vote. Alone, there is nothing to decide.
        if (state.players.filter((p) => p.connected && p.id !== me.id).length === 0) return;

        state.protestedThisRound.push(key);
        state.protest = {
          playerId: me.id,
          category,
          raw: cell.raw,
          normalised: normalise(cell.raw),
          votes: {},
          deadline: Date.now() + PROTEST_VOTE_SECONDS * 1000,
          outcome: null,
          agreeShare: 0,
        };
        await this.ctx.storage.setAlarm(state.protest.deadline);
        break;
      }

      case 'vote': {
        const p = state.protest;
        if (state.phase !== 'review' || !p || p.outcome) return;
        if (me.id === p.playerId) return; // no voting on your own word
        p.votes[me.id] = Boolean(msg.agree);

        // Close early once everyone who can vote has.
        const voters = eligibleVoters(state.players, p);
        if (voters.every((v) => v.id in p.votes)) {
          await this.settleProtest(state);
        }
        break;
      }

      case 'next': {
        if (!isHost) return;
        // Review closes into results; results advances the game.
        if (state.phase === 'review') {
          if (state.protest && !state.protest.outcome) await this.settleProtest(state);
          state.protest = null;
          state.phase = 'results';
          break;
        }
        if (state.phase !== 'results') return;
        if (state.round >= state.settings.rounds) {
          state.phase = 'finished';
          state.deadline = null;
        } else {
          await this.beginRound(state);
        }
        break;
      }

      default:
        return;
    }

    await this.save(state);
    this.broadcast(state);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const state = await this.load();
    if (!state) return;
    const att = ws.deserializeAttachment() as Attachment | null;
    const p = state.players.find((x) => x.id === att?.playerId);
    if (!p) return;

    p.connected = false;

    const live = state.players.filter((x) => x.connected);
    if (live.length === 0) {
      // Nobody left: drop the room rather than leaving it to age out.
      await this.ctx.storage.deleteAll();
      this.cache = null;
      return;
    }
    // Hand the host role on so a room is never left without a controller.
    if (p.id === state.hostId) state.hostId = live[0].id;

    // A disconnect can be the last thing a round was waiting on.
    if (state.phase === 'writing' && live.every((x) => x.submittedRound === state.round)) {
      await this.endRound(state);
    }

    await this.save(state);
    this.broadcast(state);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /**
   * The authoritative clock. Drives both phase transitions, so the timing is
   * the server's and cannot be rushed by editing the page.
   */
  async alarm(): Promise<void> {
    const state = await this.load();
    if (!state) return;

    if (state.phase === 'spinning') {
      // The wheel has landed; open the sheet.
      state.phase = 'writing';
      state.deadline = Date.now() + state.settings.roundSeconds * 1000;
      await this.ctx.storage.setAlarm(state.deadline);
    } else if (state.phase === 'writing') {
      await this.endRound(state);
    } else if (state.phase === 'review' && state.protest && !state.protest.outcome) {
      // Vote timed out: settle on the ballots actually cast.
      await this.settleProtest(state);
    } else {
      return;
    }

    await this.save(state);
    this.broadcast(state);
  }

  private async beginRound(state: RoomState): Promise<void> {
    state.round += 1;
    state.letter = pickLetter(state.settings, state.usedLetters);
    state.usedLetters.push(state.letter);
    state.answers = {};
    state.graceTriggeredBy = null;
    for (const p of state.players) p.submittedRound = -1;

    /*
      Short spin phase so the wheel has something to land on before writing
      opens. The client animates it; the server has already decided the letter.
      The transition to `writing` happens in alarm(), not here - setAlarm does
      not sleep, so doing both inline would skip the spin entirely.
    */
    state.phase = 'spinning';
    state.deadline = Date.now() + SPIN_MS;
    await this.ctx.storage.setAlarm(state.deadline);
  }

  private async endRound(state: RoomState): Promise<void> {
    if (!state.letter) return;

    state.protestedThisRound = [];
    state.protest = null;
    await this.rescore(state);

    // Straight to review so rejected answers can be argued over before the
    // scores are treated as final.
    state.phase = 'review';
    state.deadline = null;
    state.graceTriggeredBy = null;
    await this.ctx.storage.deleteAlarm();
  }

  /**
   * Recompute the current round from scratch and rebuild running totals.
   *
   * Deliberately recomputed rather than patched: a protest can turn an invalid
   * answer into a duplicate for someone else, which changes their score too.
   * Incrementally adjusting only the protester would silently desync the table.
   */
  private async rescore(state: RoomState): Promise<void> {
    if (!state.letter) return;
    const dictionaries = await this.validateAnswers(state);

    const result = scoreRound(
      state.round,
      state.letter,
      state.players,
      state.answers,
      state.settings,
      dictionaries,
      new Set(state.overrides)
    );

    // Replace this round's result, then rebuild totals from every round.
    const idx = state.results.findIndex((r) => r.round === state.round);
    if (idx >= 0) state.results[idx] = result;
    else state.results.push(result);

    for (const p of state.players) {
      p.score = state.results.reduce((sum, r) => sum + (r.totals[p.id] ?? 0), 0);
    }
  }

  private async settleProtest(state: RoomState): Promise<void> {
    const p = state.protest;
    if (!p || p.outcome) return;

    const { outcome, agreeShare, votesFor, votesAgainst } = resolveProtest(p);
    p.outcome = outcome;
    p.agreeShare = agreeShare;

    if (outcome === 'upheld') {
      const key = overrideKey(p.playerId, p.category);
      if (!state.overrides.includes(key)) state.overrides.push(key);

      // Persist to the community list so the word is recognised next time.
      try {
        const stub = this.env.DICTIONARY.get(this.env.DICTIONARY.idFromName('global'));
        await stub.fetch('https://dict/add', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            category: p.category,
            word: p.normalised,
            addedBy: state.players.find((x) => x.id === p.playerId)?.name ?? 'unknown',
            addedAt: Date.now(),
            votesFor,
            votesAgainst,
          }),
        });
      } catch {
        // The override still applies to this game even if the write failed.
      }

      await this.rescore(state);
    }

    await this.ctx.storage.deleteAlarm();
  }

  /** Full state snapshot, tailored per recipient. */
  private broadcast(state: RoomState): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      try {
        ws.send(JSON.stringify({ type: 'state', you: att.playerId, state: view(state, att.playerId) }));
      } catch {
        /* socket already gone */
      }
    }
  }

  /** Lightweight "who has finished" update during writing. */
  private broadcastProgress(state: RoomState): void {
    const filled: Record<string, number> = {};
    for (const p of state.players) {
      filled[p.id] = state.settings.categories.filter(
        (c) => (state.answers[p.id]?.[c] ?? '').trim().length > 0
      ).length;
    }
    const payload = JSON.stringify({ type: 'progress', filled });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        /* socket already gone */
      }
    }
  }
}

const SPIN_MS = 3200;

/**
 * Never ship other players' in-progress answers to the client. Without this
 * the whole game is defeated by opening devtools.
 */
function view(state: RoomState, viewerId: string): RoomState {
  if (state.phase === 'writing' || state.phase === 'spinning') {
    return {
      ...state,
      answers: { [viewerId]: state.answers[viewerId] ?? {} },
    };
  }
  return state;
}

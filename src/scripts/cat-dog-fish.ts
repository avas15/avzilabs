/**
 * Cat Dog Fish - client.
 *
 * Deliberately dependency-free and hand-rolled: the whole thing is one
 * WebSocket, one state object and a render function. The server is
 * authoritative for phase, timing, letters and scoring, so this file never
 * decides anything that matters. It draws what it is told and sends intent.
 */

type Phase = 'lobby' | 'spinning' | 'writing' | 'review' | 'results' | 'finished';
type Verdict = 'unique' | 'duplicate' | 'invalid' | 'empty';

interface Player {
  id: string;
  name: string;
  connected: boolean;
  score: number;
  submittedRound: number;
}

interface Settings {
  categories: string[];
  rounds: number;
  roundSeconds: number;
  graceSeconds: number;
  pointsUnique: number;
  pointsDuplicate: number;
  penaltyInvalid: number;
  letterPool: string;
  requireStartsWithLetter: boolean;
  useDictionaries: boolean;
  noRepeatLetters: boolean;
}

interface CategoryScore {
  raw: string;
  normalised: string;
  points: number;
  verdict: Verdict;
  sharedWith: string[];
}

interface RoundResult {
  round: number;
  letter: string;
  breakdown: Record<string, Record<string, CategoryScore>>;
  totals: Record<string, number>;
}

interface Protest {
  playerId: string;
  category: string;
  raw: string;
  normalised: string;
  votes: Record<string, boolean>;
  deadline: number;
  outcome: 'upheld' | 'rejected' | null;
  agreeShare: number;
}

interface RoomState {
  code: string;
  hostId: string;
  phase: Phase;
  settings: Settings;
  players: Player[];
  round: number;
  letter: string | null;
  usedLetters: string[];
  answers: Record<string, Record<string, string>>;
  deadline: number | null;
  graceTriggeredBy: string | null;
  results: RoundResult[];
  overrides: string[];
  protest: Protest | null;
  protestedThisRound: string[];
}

const PRESETS: Record<string, string[]> = {
  Classic: ['Animal', 'Food', 'Boy name', 'Girl name', 'Country', 'Colour'],
  'Cat Dog Fish': ['Animal', 'Food', 'Drink', 'Chocolate', 'Boy name', 'Girl name'],
  'Pub quiz': ['Film', 'Band', 'Footballer', 'City', 'Book', 'TV show'],
  Hard: ['Historical figure', 'Element', 'Capital city', 'Verb', 'Job', 'Something cold'],
};

export function mountGame(root: HTMLElement, origin: string): void {
  let ws: WebSocket | null = null;
  let state: RoomState | null = null;
  let me = '';
  let progress: Record<string, number> = {};
  let error = '';
  let connecting = false;
  /** Local echo so typing is never clobbered by an inbound snapshot. */
  const draft: Record<string, string> = {};
  let spinTarget = '';

  const httpBase = origin.replace(/\/$/, '');
  const wsBase = httpBase.replace(/^http/, 'ws');

  const esc = (s: string) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
    );

  const isHost = () => !!state && state.hostId === me;
  const meP = () => state?.players.find((p) => p.id === me) ?? null;

  // ---------------------------------------------------------------- network

  function connect(code: string, name: string, create: boolean) {
    if (connecting) return;
    connecting = true;
    error = '';
    render();

    const url = `${wsBase}/ws?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}${
      create ? '&create=1' : ''
    }`;
    const sock = new WebSocket(url);
    ws = sock;

    sock.addEventListener('open', () => {
      connecting = false;
      try {
        sessionStorage.setItem('cdf:name', name);
        sessionStorage.setItem('cdf:code', code);
      } catch (e) {
        /* private mode */
      }
      render();
    });

    sock.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'state') {
        const prev = state;
        me = msg.you;
        state = msg.state as RoomState;

        // Landing on a new letter: play the wheel to it.
        if (state.phase === 'spinning' && prev?.phase !== 'spinning' && state.letter) {
          spinTarget = state.letter;
        }
        // A fresh round means a fresh sheet.
        if (prev && prev.round !== state.round) {
          for (const k of Object.keys(draft)) delete draft[k];
          progress = {};
        }
        render();
      } else if (msg.type === 'progress') {
        progress = msg.filled;
        paintProgress();
      }
    });

    sock.addEventListener('close', (ev) => {
      connecting = false;
      ws = null;
      if (ev.code === 4000) error = 'The host removed you from the room.';
      else if (!state) error = 'Could not join. Check the code, or the room may be full.';
      else error = 'Disconnected.';
      state = null;
      render();
    });

    sock.addEventListener('error', () => {
      connecting = false;
      if (!state) error = 'Could not reach the game server.';
      render();
    });
  }

  const send = (msg: Record<string, unknown>) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  async function createRoom(name: string) {
    error = '';
    render();
    try {
      const res = await fetch(`${httpBase}/api/rooms`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const { code } = (await res.json()) as { code: string };
      connect(code, name, true);
    } catch {
      error = 'Could not reach the game server. It may not be deployed yet.';
      render();
    }
  }

  // ------------------------------------------------------------------ views

  function joinView(): string {
    let name = '';
    let code = '';
    try {
      name = sessionStorage.getItem('cdf:name') ?? '';
      code = new URLSearchParams(location.search).get('room') ?? '';
    } catch (e) {
      /* ignore */
    }

    return `
      <div class="term term-corners max-w-lg">
        <div class="term-bar"><span class="text-brand">●</span><span>join a game</span></div>
        <div class="p-6">
          ${error ? `<p class="mb-4 border border-[var(--danger)] p-3 text-[13px] text-[var(--danger)]">${esc(error)}</p>` : ''}
          <label class="block text-[11px] uppercase tracking-wider text-ink-3" for="cdf-name">your name</label>
          <input id="cdf-name" maxlength="20" value="${esc(name)}" placeholder="who are you"
                 class="mt-1 w-full border border-line bg-bg-subtle px-3 py-2 text-ink outline-none focus:border-brand" />

          <label class="mt-5 block text-[11px] uppercase tracking-wider text-ink-3" for="cdf-code">room code</label>
          <div class="mt-1 flex gap-2">
            <input id="cdf-code" maxlength="8" value="${esc(code)}" placeholder="ABCD"
                   class="w-full border border-line bg-bg-subtle px-3 py-2 uppercase tracking-[0.3em] text-ink outline-none focus:border-brand" />
            <button data-act="join" class="shrink-0 border border-line-strong px-4 text-[13px] text-ink-2 hover:border-brand hover:text-brand">join</button>
          </div>

          <div class="my-5 flex items-center gap-3 text-[11px] text-ink-3">
            <div class="h-px flex-1 bg-line"></div>or<div class="h-px flex-1 bg-line"></div>
          </div>

          <button data-act="create" ${connecting ? 'disabled' : ''}
                  class="w-full border border-brand bg-brand px-4 py-2.5 text-[13px] font-700 text-on-brand hover:bg-transparent hover:text-brand disabled:opacity-50">
            ${connecting ? 'connecting...' : '[ start a new game ]'}
          </button>
        </div>
      </div>`;
  }

  function playerList(s: RoomState): string {
    return s.players
      .map((p) => {
        const done = s.phase === 'writing' && p.submittedRound === s.round;
        const filled = progress[p.id];
        const total = s.settings.categories.length;
        return `
        <li class="flex items-center gap-2 border-b border-line py-2 text-[13px] last:border-0">
          <span class="${p.connected ? 'text-brand' : 'text-ink-3'}">${p.connected ? '●' : '○'}</span>
          <span class="${p.id === me ? 'text-ink' : 'text-ink-2'}">${esc(p.name)}${p.id === me ? ' (you)' : ''}</span>
          ${p.id === s.hostId ? '<span class="tag">host</span>' : ''}
          ${done ? '<span class="text-[11px] text-brand">done</span>' : ''}
          ${!done && s.phase === 'writing' && filled !== undefined ? `<span class="text-[11px] text-ink-3 tnum">${filled}/${total}</span>` : ''}
          <span class="ml-auto tnum text-ink">${p.score}</span>
          ${isHost() && p.id !== me ? `<button data-act="kick" data-id="${p.id}" class="text-[11px] text-ink-3 hover:text-[var(--danger)]">kick</button>` : ''}
        </li>`;
      })
      .join('');
  }

  function settingsPanel(s: RoomState): string {
    if (!isHost()) {
      return `<p class="text-[13px] text-ink-3">Waiting for ${esc(
        s.players.find((p) => p.id === s.hostId)?.name ?? 'the host'
      )} to start.</p>`;
    }
    const num = (id: string, label: string, val: number, min: number, max: number) => `
      <label class="block">
        <span class="text-[11px] uppercase tracking-wider text-ink-3">${label}</span>
        <input type="number" data-set="${id}" value="${val}" min="${min}" max="${max}"
               class="mt-1 w-full border border-line bg-bg-subtle px-2 py-1.5 text-[13px] text-ink tnum outline-none focus:border-brand" />
      </label>`;

    return `
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        ${num('rounds', 'rounds', s.settings.rounds, 1, 20)}
        ${num('roundSeconds', 'seconds / round', s.settings.roundSeconds, 15, 600)}
        ${num('graceSeconds', 'finish countdown', s.settings.graceSeconds, 0, 120)}
        ${num('pointsUnique', 'unique pts', s.settings.pointsUnique, 0, 100)}
        ${num('pointsDuplicate', 'duplicate pts', s.settings.pointsDuplicate, 0, 100)}
        ${num('penaltyInvalid', 'wrong answer pts', s.settings.penaltyInvalid, -50, 0)}
      </div>

      <label class="mt-4 block">
        <span class="text-[11px] uppercase tracking-wider text-ink-3">categories (one per line)</span>
        <textarea data-set="categories" rows="6"
          class="mt-1 w-full border border-line bg-bg-subtle px-2 py-1.5 text-[13px] text-ink outline-none focus:border-brand">${esc(
            s.settings.categories.join('\n')
          )}</textarea>
      </label>

      <div class="mt-3 flex flex-wrap gap-1.5">
        <span class="text-[11px] uppercase tracking-wider text-ink-3">presets:</span>
        ${Object.keys(PRESETS)
          .map(
            (k) =>
              `<button data-preset="${esc(k)}" class="tag hover:border-brand hover:text-brand">${esc(k)}</button>`
          )
          .join('')}
      </div>

      <label class="mt-4 block">
        <span class="text-[11px] uppercase tracking-wider text-ink-3">letters the wheel can land on</span>
        <input data-set="letterPool" value="${esc(s.settings.letterPool)}"
               class="mt-1 w-full border border-line bg-bg-subtle px-2 py-1.5 text-[13px] uppercase tracking-widest text-ink outline-none focus:border-brand" />
      </label>

      <div class="mt-4 space-y-2 text-[13px]">
        <label class="flex items-center gap-2">
          <input type="checkbox" data-set="useDictionaries" ${s.settings.useDictionaries ? 'checked' : ''} />
          <span class="text-ink-2">check answers against the community dictionary</span>
        </label>
        <label class="flex items-center gap-2">
          <input type="checkbox" data-set="noRepeatLetters" ${s.settings.noRepeatLetters ? 'checked' : ''} />
          <span class="text-ink-2">never repeat a letter in one game</span>
        </label>
      </div>

      <button data-act="start"
        class="mt-6 w-full border border-brand bg-brand px-4 py-2.5 text-[13px] font-700 text-on-brand hover:bg-transparent hover:text-brand">
        [ start round 1 ]
      </button>`;
  }

  function wheel(s: RoomState): string {
    const pool = s.settings.letterPool.split('');
    const shown = spinTarget || s.letter || '?';
    return `
      <div class="term term-corners">
        <div class="term-bar"><span>wheel</span><span class="ml-auto tnum">round ${s.round}/${s.settings.rounds}</span></div>
        <div class="flex flex-col items-center justify-center gap-4 p-10">
          <div class="text-[11px] uppercase tracking-[0.3em] text-ink-3">the letter is</div>
          <div id="cdf-wheel" class="teletext glow text-[5rem] leading-none text-brand sm:text-[7rem]">${esc(shown)}</div>
          <div class="ascii max-w-full overflow-hidden text-center text-[10px] text-ink-3">${esc(pool.join(' '))}</div>
        </div>
      </div>`;
  }

  function sheet(s: RoomState): string {
    const submitted = (meP()?.submittedRound ?? -1) === s.round;
    const mine = s.answers[me] ?? {};

    const rows = s.settings.categories
      .map((c, i) => {
        const val = draft[c] ?? mine[c] ?? '';
        return `
        <label class="flex flex-col gap-1 border-b border-line p-3 sm:flex-row sm:items-center sm:gap-4">
          <span class="w-40 shrink-0 text-[12px] uppercase tracking-wider text-ink-3">${esc(c)}</span>
          <input data-cat="${esc(c)}" value="${esc(val)}" maxlength="60" ${submitted ? 'disabled' : ''}
                 autocomplete="off" spellcheck="false" ${i === 0 ? 'autofocus' : ''}
                 class="w-full border border-line bg-bg-subtle px-3 py-2 text-ink outline-none focus:border-brand disabled:opacity-60" />
        </label>`;
      })
      .join('');

    return `
      <div class="term term-corners">
        <div class="term-bar">
          <span class="text-brand">${esc(s.letter ?? '?')}</span>
          <span>your sheet</span>
          <span class="ml-auto tnum" id="cdf-timer">--</span>
        </div>
        ${
          s.graceTriggeredBy
            ? `<p class="border-b border-line bg-bg-subtle px-3 py-2 text-[12px] text-warn">
                 ${esc(s.players.find((p) => p.id === s.graceTriggeredBy)?.name ?? 'Someone')} finished.
                 Everyone else is on the countdown.
               </p>`
            : ''
        }
        ${rows}
        <div class="p-4">
          ${
            submitted
              ? '<p class="text-[13px] text-brand">Locked in. Waiting for everyone else.</p>'
              : `<button data-act="submit"
                   class="w-full border border-brand bg-brand px-4 py-2.5 text-[13px] font-700 text-on-brand hover:bg-transparent hover:text-brand">
                   [ done ]
                 </button>`
          }
        </div>
      </div>`;
  }

  function protestPanel(s: RoomState): string {
    const p = s.protest;
    if (!p) return '';
    const author = s.players.find((x) => x.id === p.playerId)?.name ?? '?';
    const votes = Object.values(p.votes);
    const yes = votes.filter(Boolean).length;
    const voters = s.players.filter((x) => x.connected && x.id !== p.playerId).length;
    const iVoted = me in p.votes;
    const canVote = me !== p.playerId && !p.outcome;

    return `
      <div class="term term-corners border-[var(--warn)]">
        <div class="term-bar"><span class="text-warn">!</span><span>protest</span>
          <span class="ml-auto tnum" id="cdf-vote-timer">--</span></div>
        <div class="p-5">
          <p class="text-[14px] text-ink">
            <span class="text-brand">${esc(author)}</span> says
            <span class="text-ink">"${esc(p.raw)}"</span> is a valid
            <span class="text-ink-3">${esc(p.category)}</span>.
          </p>
          <p class="mt-1 text-[12px] text-ink-3">
            Needs more than two thirds to stand. ${yes}/${votes.length} in favour, ${voters} can vote.
          </p>

          ${
            p.outcome
              ? `<p class="mt-4 text-[13px] ${p.outcome === 'upheld' ? 'text-brand' : 'text-[var(--danger)]'}">
                   ${
                     p.outcome === 'upheld'
                       ? `Upheld at ${Math.round(p.agreeShare * 100)}%. Added to the community dictionary and rescored.`
                       : `Rejected at ${Math.round(p.agreeShare * 100)}%. The original ruling stands.`
                   }
                 </p>`
              : canVote
                ? `<div class="mt-4 flex gap-2">
                     <button data-act="vote" data-agree="1" ${iVoted ? 'disabled' : ''}
                       class="flex-1 border border-brand px-3 py-2 text-[13px] text-brand hover:bg-brand hover:text-on-brand disabled:opacity-40">
                       [ it counts ]
                     </button>
                     <button data-act="vote" data-agree="0" ${iVoted ? 'disabled' : ''}
                       class="flex-1 border border-[var(--danger)] px-3 py-2 text-[13px] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-bg disabled:opacity-40">
                       [ no chance ]
                     </button>
                   </div>
                   ${iVoted ? '<p class="mt-2 text-[12px] text-ink-3">Vote cast. Waiting for the rest.</p>' : ''}`
                : '<p class="mt-4 text-[12px] text-ink-3">You cannot vote on your own answer.</p>'
          }
        </div>
      </div>`;
  }

  function reviewTable(s: RoomState): string {
    const last = s.results[s.results.length - 1];
    if (!last) return '';

    const header = `<tr class="text-[11px] uppercase tracking-wider text-ink-3">
        <th class="p-2 text-left">category</th>
        ${s.players.map((p) => `<th class="p-2 text-left">${esc(p.name)}</th>`).join('')}
      </tr>`;

    const rows = s.settings.categories
      .map((c) => {
        const cells = s.players
          .map((p) => {
            const cell = last.breakdown[p.id]?.[c];
            if (!cell) return '<td class="p-2 text-ink-3">-</td>';
            const tone =
              cell.verdict === 'unique'
                ? 'text-brand'
                : cell.verdict === 'duplicate'
                  ? 'text-ink-2'
                  : cell.verdict === 'invalid'
                    ? 'text-[var(--danger)]'
                    : 'text-ink-3';
            const canProtest =
              p.id === me &&
              cell.verdict === 'invalid' &&
              !s.protest &&
              !s.protestedThisRound.includes(`${me}::${c}`);
            return `<td class="p-2 align-top">
                <div class="${tone}">${cell.raw ? esc(cell.raw) : '<span class="text-ink-3">-</span>'}</div>
                <div class="text-[11px] text-ink-3 tnum">${cell.points > 0 ? '+' : ''}${cell.points}</div>
                ${canProtest ? `<button data-act="protest" data-cat="${esc(c)}" class="mt-1 text-[11px] text-warn hover:underline">protest</button>` : ''}
              </td>`;
          })
          .join('');
        return `<tr class="border-t border-line">
            <td class="p-2 text-[12px] uppercase tracking-wider text-ink-3">${esc(c)}</td>${cells}
          </tr>`;
      })
      .join('');

    const totals = s.players
      .map((p) => `<td class="p-2 tnum text-brand">+${last.totals[p.id] ?? 0}</td>`)
      .join('');

    return `
      <div class="term term-corners overflow-x-auto">
        <div class="term-bar">
          <span class="text-brand">${esc(last.letter)}</span>
          <span>round ${last.round} answers</span>
        </div>
        <table class="w-full min-w-[36rem] text-[13px]">
          <thead>${header}</thead>
          <tbody>${rows}
            <tr class="border-t-2 border-line-strong">
              <td class="p-2 text-[12px] uppercase tracking-wider text-ink-3">round</td>${totals}
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  function scoreboard(s: RoomState): string {
    const ranked = [...s.players].sort((a, b) => b.score - a.score);
    return `
      <div class="term term-corners">
        <div class="term-bar"><span>${s.phase === 'finished' ? 'final' : 'standings'}</span></div>
        <ol class="p-4">
          ${ranked
            .map(
              (p, i) => `
            <li class="flex items-center gap-3 border-b border-line py-2 text-[14px] last:border-0">
              <span class="w-6 tnum text-ink-3">${i + 1}</span>
              <span class="${i === 0 && s.phase === 'finished' ? 'text-brand glow' : 'text-ink'}">${esc(p.name)}</span>
              <span class="ml-auto tnum text-brand">${p.score}</span>
            </li>`
            )
            .join('')}
        </ol>
      </div>`;
  }

  // ----------------------------------------------------------------- render

  function render() {
    if (!state) {
      root.innerHTML = joinView();
      wire();
      return;
    }
    const s = state;

    const shell = (main: string) => `
      <div class="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div class="space-y-5">${main}</div>
        <aside class="space-y-5">
          <div class="term term-corners">
            <div class="term-bar">
              <span>room</span>
              <span class="ml-auto tracking-[0.3em] text-brand">${esc(s.code)}</span>
            </div>
            <div class="p-3">
              <button data-act="copy" class="w-full border border-line px-2 py-1.5 text-[11px] text-ink-3 hover:border-brand hover:text-brand">
                copy invite link
              </button>
              <ul class="mt-3">${playerList(s)}</ul>
            </div>
          </div>
        </aside>
      </div>`;

    let main = '';
    if (s.phase === 'lobby') {
      main = `<div class="term term-corners">
          <div class="term-bar"><span>lobby</span><span class="ml-auto">${s.players.length}/10</span></div>
          <div class="p-5">${settingsPanel(s)}</div>
        </div>`;
    } else if (s.phase === 'spinning') {
      main = wheel(s);
    } else if (s.phase === 'writing') {
      main = sheet(s);
    } else if (s.phase === 'review') {
      main = `${protestPanel(s)}${reviewTable(s)}
        ${
          isHost()
            ? `<button data-act="next" class="w-full border border-brand bg-brand px-4 py-2.5 text-[13px] font-700 text-on-brand hover:bg-transparent hover:text-brand">
                 [ ${s.protest && !s.protest.outcome ? 'close vote and continue' : 'continue'} ]
               </button>`
            : '<p class="text-[13px] text-ink-3">Protest anything that was rejected. The host moves on when everyone is done.</p>'
        }`;
    } else if (s.phase === 'results' || s.phase === 'finished') {
      main = `${scoreboard(s)}${reviewTable(s)}
        ${
          isHost()
            ? `<button data-act="next" class="w-full border border-brand bg-brand px-4 py-2.5 text-[13px] font-700 text-on-brand hover:bg-transparent hover:text-brand">
                 [ ${s.phase === 'finished' ? 'play again' : `start round ${s.round + 1}`} ]
               </button>`
            : ''
        }`;
      if (s.phase === 'finished' && isHost()) {
        main = `${scoreboard(s)}
          <button data-act="start" class="w-full border border-brand bg-brand px-4 py-2.5 text-[13px] font-700 text-on-brand hover:bg-transparent hover:text-brand">
            [ play again ]
          </button>${reviewTable(s)}`;
      }
    }

    root.innerHTML = shell(main);
    wire();
    tick();
  }

  /** Repaint only the per-player counters, so typing is never interrupted. */
  function paintProgress() {
    if (!state || state.phase !== 'writing') return;
    const list = root.querySelector('aside ul');
    if (list) list.innerHTML = playerList(state);
  }

  // ------------------------------------------------------------------ timer

  let timerId = 0;
  function tick() {
    clearInterval(timerId);
    timerId = window.setInterval(() => {
      if (!state) return;
      const fmt = (ms: number) => {
        const t = Math.max(0, Math.ceil(ms / 1000));
        return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      };
      const main = root.querySelector('#cdf-timer');
      if (main && state.deadline) {
        const left = state.deadline - Date.now();
        main.textContent = fmt(left);
        main.classList.toggle('text-[var(--danger)]', left < 10_000);
      }
      const vote = root.querySelector('#cdf-vote-timer');
      if (vote && state.protest && !state.protest.outcome) {
        vote.textContent = fmt(state.protest.deadline - Date.now());
      }
    }, 250);
  }

  // ----------------------------------------------------------------- wiring

  function readSettings(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-set]').forEach((el) => {
      const key = el.dataset.set!;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') out[key] = el.checked;
      else if (key === 'categories')
        out[key] = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
      else if (el instanceof HTMLInputElement && el.type === 'number') out[key] = Number(el.value);
      else out[key] = el.value;
    });
    return out;
  }

  function wire() {
    root.querySelector('[data-act="create"]')?.addEventListener('click', () => {
      const name = (root.querySelector<HTMLInputElement>('#cdf-name')?.value ?? '').trim();
      if (!name) {
        error = 'Pick a name first.';
        render();
        return;
      }
      createRoom(name);
    });

    root.querySelector('[data-act="join"]')?.addEventListener('click', () => {
      const name = (root.querySelector<HTMLInputElement>('#cdf-name')?.value ?? '').trim();
      const code = (root.querySelector<HTMLInputElement>('#cdf-code')?.value ?? '')
        .trim()
        .toUpperCase();
      if (!name || !code) {
        error = 'Name and room code are both needed.';
        render();
        return;
      }
      connect(code, name, false);
    });

    root.querySelector('[data-act="start"]')?.addEventListener('click', () => {
      if (isHost() && state?.phase === 'lobby') send({ type: 'settings', settings: readSettings() });
      send({ type: 'start' });
    });

    root.querySelector('[data-act="submit"]')?.addEventListener('click', () => send({ type: 'submit' }));
    root.querySelector('[data-act="next"]')?.addEventListener('click', () => send({ type: 'next' }));

    root.querySelectorAll('[data-act="vote"]').forEach((b) =>
      b.addEventListener('click', () =>
        send({ type: 'vote', agree: (b as HTMLElement).dataset.agree === '1' })
      )
    );
    root.querySelectorAll('[data-act="protest"]').forEach((b) =>
      b.addEventListener('click', () =>
        send({ type: 'protest', category: (b as HTMLElement).dataset.cat })
      )
    );
    root.querySelectorAll('[data-act="kick"]').forEach((b) =>
      b.addEventListener('click', () =>
        send({ type: 'kick', playerId: (b as HTMLElement).dataset.id })
      )
    );
    root.querySelectorAll('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        const ta = root.querySelector<HTMLTextAreaElement>('[data-set="categories"]');
        const preset = PRESETS[(b as HTMLElement).dataset.preset!];
        if (ta && preset) ta.value = preset.join('\n');
      })
    );

    root.querySelector('[data-act="copy"]')?.addEventListener('click', async (e) => {
      const url = `${location.origin}${location.pathname}?room=${state?.code ?? ''}`;
      try {
        await navigator.clipboard.writeText(url);
        (e.currentTarget as HTMLElement).textContent = 'copied';
      } catch {
        (e.currentTarget as HTMLElement).textContent = url;
      }
    });

    // Answer inputs: debounce so a fast typist does not emit a message
    // per keystroke, but still feels live to everyone watching progress.
    let t = 0;
    root.querySelectorAll<HTMLInputElement>('[data-cat]').forEach((input) => {
      input.addEventListener('input', () => {
        const cat = input.dataset.cat!;
        draft[cat] = input.value;
        clearTimeout(t);
        t = window.setTimeout(() => send({ type: 'answer', category: cat, value: input.value }), 220);
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const all = [...root.querySelectorAll<HTMLInputElement>('[data-cat]')];
        const i = all.indexOf(input);
        if (i < all.length - 1) all[i + 1].focus();
        else send({ type: 'submit' });
      });
    });
  }

  render();
}

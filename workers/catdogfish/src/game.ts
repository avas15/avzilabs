import { overrideKey } from './types';
import type {
  AnswerSheet,
  CategoryScore,
  Player,
  Protest,
  RoundResult,
  ScoreVerdict,
  Settings,
} from './types';
import { PROTEST_THRESHOLD } from './types';

/**
 * Pure game logic. No Durable Object, no WebSocket, no clock.
 *
 * Everything here is a function of its inputs so the rules can be tested
 * directly, which matters because scoring disputes are the one thing that
 * ruins a party game.
 */

/**
 * Fold an answer down to the form used for duplicate detection.
 *
 * Deliberately aggressive: accents stripped, punctuation dropped, whitespace
 * collapsed, and a leading article removed. Without the article rule "the
 * lion" and "lion" score as different answers, which nobody at the table
 * accepts as correct.
 */
export function normalise(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');
}

/** First alphabetic character, used for the starts-with-letter rule. */
function firstLetter(normalised: string): string {
  const m = normalised.match(/[a-z]/);
  return m ? m[0].toUpperCase() : '';
}

export function isValidAnswer(
  raw: string,
  letter: string,
  settings: Settings,
  dictionary?: Set<string>
): boolean {
  const n = normalise(raw);
  if (!n) return false;
  if (settings.requireStartsWithLetter && firstLetter(n) !== letter.toUpperCase()) {
    return false;
  }
  // A dictionary only ever applies where one has actually been supplied.
  if (settings.useDictionaries && dictionary && dictionary.size > 0) {
    return dictionary.has(n);
  }
  return true;
}

/**
 * Score one round.
 *
 * Duplicate detection is per category and uses normalised text, so
 * "Elephant" and " elephant " collide as they should.
 */
export function scoreRound(
  round: number,
  letter: string,
  players: Player[],
  answers: AnswerSheet,
  settings: Settings,
  dictionaries: Record<string, Set<string>> = {},
  /**
   * "playerId::category" entries the table voted back in. These bypass
   * validation entirely, so a re-score after a protest is deterministic.
   */
  overrides: Set<string> = new Set()
): RoundResult {
  const accepted = (playerId: string, category: string, raw: string) =>
    overrides.has(overrideKey(playerId, category)) ||
    isValidAnswer(raw, letter, settings, dictionaries[category]);

  const breakdown: Record<string, Record<string, CategoryScore>> = {};
  const totals: Record<string, number> = {};
  const nameById = new Map(players.map((p) => [p.id, p.name]));

  for (const p of players) {
    breakdown[p.id] = {};
    totals[p.id] = 0;
  }

  for (const category of settings.categories) {
    // Group valid answers by normalised text to find collisions.
    const groups = new Map<string, string[]>();

    for (const p of players) {
      const raw = (answers[p.id]?.[category] ?? '').slice(0, 200);
      if (!normalise(raw)) continue;
      if (!accepted(p.id, category, raw)) continue;
      const key = normalise(raw);
      const list = groups.get(key) ?? [];
      list.push(p.id);
      groups.set(key, list);
    }

    for (const p of players) {
      const raw = answers[p.id]?.[category] ?? '';
      const n = normalise(raw);

      let verdict: ScoreVerdict;
      let points: number;
      let sharedWith: string[] = [];

      if (!n) {
        verdict = 'empty';
        points = 0;
      } else if (!accepted(p.id, category, raw)) {
        verdict = 'invalid';
        points = settings.penaltyInvalid;
      } else {
        const group = groups.get(n) ?? [];
        if (group.length > 1) {
          verdict = 'duplicate';
          points = settings.pointsDuplicate;
          sharedWith = group
            .filter((id) => id !== p.id)
            .map((id) => nameById.get(id) ?? '?');
        } else {
          verdict = 'unique';
          points = settings.pointsUnique;
        }
      }

      breakdown[p.id][category] = { raw, normalised: n, points, verdict, sharedWith };
      totals[p.id] += points;
    }
  }

  return { round, letter, breakdown, totals };
}

/**
 * Pick the next letter.
 *
 * Takes an explicit rng so rounds are reproducible in tests. Falls back to
 * reusing the pool once every letter has been consumed, rather than
 * deadlocking a long game.
 */
export function pickLetter(
  settings: Settings,
  usedLetters: string[],
  rng: () => number = Math.random
): string {
  const pool = settings.letterPool.toUpperCase().replace(/[^A-Z]/g, '');
  if (!pool) return 'A';

  let candidates = pool.split('');
  if (settings.noRepeatLetters) {
    const remaining = candidates.filter((c) => !usedLetters.includes(c));
    if (remaining.length > 0) candidates = remaining;
  }
  return candidates[Math.floor(rng() * candidates.length)] ?? 'A';
}

/** A player counts as done when every category has something in it. */
export function hasFilledAll(
  playerId: string,
  answers: AnswerSheet,
  settings: Settings
): boolean {
  const sheet = answers[playerId] ?? {};
  return settings.categories.every((c) => normalise(sheet[c] ?? '').length > 0);
}

/**
 * Resolve a protest.
 *
 * The bar is deliberately high: the answer only stands with an overwhelming
 * majority, strictly greater than two thirds of the votes actually cast. The
 * player who wrote it does not get a vote on their own answer, and abstentions
 * are ignored rather than counted as opposition, so a couple of people wandering
 * off does not silently sink a fair word.
 *
 * A tie or an empty ballot rejects, because the default is the dictionary's
 * ruling rather than the table's.
 */
export function resolveProtest(protest: Protest): {
  outcome: 'upheld' | 'rejected';
  agreeShare: number;
  votesFor: number;
  votesAgainst: number;
} {
  const cast = Object.values(protest.votes);
  const votesFor = cast.filter(Boolean).length;
  const votesAgainst = cast.length - votesFor;
  const agreeShare = cast.length === 0 ? 0 : votesFor / cast.length;
  return {
    outcome: agreeShare > PROTEST_THRESHOLD ? 'upheld' : 'rejected',
    agreeShare,
    votesFor,
    votesAgainst,
  };
}

/** Everyone in the room except whoever wrote the answer. */
export function eligibleVoters(players: Player[], protest: Protest): Player[] {
  return players.filter((p) => p.connected && p.id !== protest.playerId);
}

export function sanitiseSettings(input: Partial<Settings>, base: Settings): Settings {
  const clamp = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };

  const categories = Array.isArray(input.categories)
    ? input.categories
        .map((c) => String(c).trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 16)
    : base.categories;

  const pool = String(input.letterPool ?? base.letterPool)
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

  return {
    categories: categories.length ? categories : base.categories,
    rounds: clamp(input.rounds, 1, 20, base.rounds),
    roundSeconds: clamp(input.roundSeconds, 15, 600, base.roundSeconds),
    graceSeconds: clamp(input.graceSeconds, 0, 120, base.graceSeconds),
    pointsUnique: clamp(input.pointsUnique, 0, 100, base.pointsUnique),
    pointsDuplicate: clamp(input.pointsDuplicate, 0, 100, base.pointsDuplicate),
    penaltyInvalid: clamp(input.penaltyInvalid, -50, 0, base.penaltyInvalid),
    letterPool: pool.length ? pool : base.letterPool,
    requireStartsWithLetter:
      typeof input.requireStartsWithLetter === 'boolean'
        ? input.requireStartsWithLetter
        : base.requireStartsWithLetter,
    useDictionaries:
      typeof input.useDictionaries === 'boolean' ? input.useDictionaries : base.useDictionaries,
    noRepeatLetters:
      typeof input.noRepeatLetters === 'boolean' ? input.noRepeatLetters : base.noRepeatLetters,
  };
}

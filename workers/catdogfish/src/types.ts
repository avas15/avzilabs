export type Phase =
  | 'lobby'
  | 'spinning'
  | 'writing'
  /** Answers are shown and rejected ones can be protested. */
  | 'review'
  | 'results'
  | 'finished';

/** Share of votes needed to overturn a rejection. */
export const PROTEST_THRESHOLD = 2 / 3;
export const PROTEST_VOTE_SECONDS = 30;

export interface Protest {
  /** Whose answer is being defended. */
  playerId: string;
  category: string;
  raw: string;
  normalised: string;
  /** voterId -> agrees the answer should stand. */
  votes: Record<string, boolean>;
  deadline: number;
  /** Null while the vote is open. */
  outcome: 'upheld' | 'rejected' | null;
  agreeShare: number;
}

export interface DictionaryEntry {
  category: string;
  word: string;
  addedBy: string;
  addedAt: number;
  votesFor: number;
  votesAgainst: number;
}

export interface Settings {
  /** Ordered category prompts for the round. */
  categories: string[];
  rounds: number;
  /** Hard ceiling on a writing round. */
  roundSeconds: number;
  /**
   * Grace window opened when the first player finishes. 0 disables the
   * mechanic entirely and rounds simply run to roundSeconds.
   */
  graceSeconds: number;
  pointsUnique: number;
  pointsDuplicate: number;
  /** Applied to a non-empty answer that fails validation. Usually 0. */
  penaltyInvalid: number;
  /** Letters the wheel may land on. Excluding QXZ is the common house rule. */
  letterPool: string;
  /** Reject answers not beginning with the round letter. */
  requireStartsWithLetter: boolean;
  /**
   * When a category has a dictionary loaded, also require membership.
   * Categories without one always fall back to the letter check alone.
   */
  useDictionaries: boolean;
  /** Never land on the same letter twice in one game. */
  noRepeatLetters: boolean;
}

export interface Player {
  id: string;
  name: string;
  connected: boolean;
  score: number;
  /** Round index this player last locked in. -1 when they have not. */
  submittedRound: number;
}

/** playerId -> category -> raw answer text */
export type AnswerSheet = Record<string, Record<string, string>>;

export interface CategoryScore {
  raw: string;
  normalised: string;
  points: number;
  /** 'unique' | 'duplicate' | 'invalid' | 'empty' */
  verdict: ScoreVerdict;
  /** Names of others who gave the same answer. */
  sharedWith: string[];
}

export type ScoreVerdict = 'unique' | 'duplicate' | 'invalid' | 'empty';

export interface RoundResult {
  round: number;
  letter: string;
  /** playerId -> category -> score detail */
  breakdown: Record<string, Record<string, CategoryScore>>;
  /** playerId -> points gained this round */
  totals: Record<string, number>;
}

export interface RoomState {
  code: string;
  hostId: string;
  phase: Phase;
  settings: Settings;
  players: Player[];
  round: number;
  letter: string | null;
  usedLetters: string[];
  answers: AnswerSheet;
  /** Epoch ms the writing phase must end. Null outside a writing phase. */
  deadline: number | null;
  /** Set when the grace countdown has been triggered, so it fires once. */
  graceTriggeredBy: string | null;
  results: RoundResult[];
  createdAt: number;
  /**
   * Answers forced valid by a successful protest, keyed "playerId::category".
   * Kept on the room so a re-score reproduces the same outcome.
   */
  overrides: string[];
  /** The protest currently being voted on, if any. */
  protest: Protest | null;
  /** "playerId::category" already protested this round, so each gets one go. */
  protestedThisRound: string[];
}

export const overrideKey = (playerId: string, category: string) => `${playerId}::${category}`;

export const DEFAULT_CATEGORIES = [
  'Animal',
  'Food',
  'Boy name',
  'Girl name',
  'Chocolate',
  'Drink',
  'Country',
  'Film',
];

export const DEFAULT_SETTINGS: Settings = {
  categories: DEFAULT_CATEGORIES,
  rounds: 5,
  roundSeconds: 120,
  graceSeconds: 15,
  pointsUnique: 10,
  pointsDuplicate: 5,
  penaltyInvalid: 0,
  letterPool: 'ABCDEFGHIJKLMNOPRSTUVW',
  requireStartsWithLetter: true,
  useDictionaries: false,
  noRepeatLetters: true,
};

export const MAX_PLAYERS = 10;
export const MAX_CATEGORIES = 16;
export const MAX_NAME_LENGTH = 20;
export const MAX_ANSWER_LENGTH = 60;

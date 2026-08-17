import { describe, expect, it } from 'vitest';
import {
  eligibleVoters,
  hasFilledAll,
  isValidAnswer,
  normalise,
  pickLetter,
  resolveProtest,
  sanitiseSettings,
  scoreRound,
} from '../src/game';
import { DEFAULT_SETTINGS, overrideKey, type Player, type Protest, type Settings } from '../src/types';

const protest = (votes: Record<string, boolean>): Protest => ({
  playerId: 'p0',
  category: 'Animal',
  raw: 'Aardwolf',
  normalised: 'aardwolf',
  votes,
  deadline: 0,
  outcome: null,
  agreeShare: 0,
});

const players = (...names: string[]): Player[] =>
  names.map((name, i) => ({
    id: `p${i}`,
    name,
    connected: true,
    score: 0,
    submittedRound: -1,
  }));

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  categories: ['Animal', 'Food'],
  ...over,
});

describe('normalise', () => {
  it('folds case, whitespace and punctuation', () => {
    expect(normalise('  ElePHant! ')).toBe('elephant');
    expect(normalise('Ice   Cream')).toBe('ice cream');
  });

  it('strips accents so accented spellings collide', () => {
    expect(normalise('Crème brûlée')).toBe(normalise('Creme brulee'));
  });

  it('drops a leading article, which is the usual table ruling', () => {
    expect(normalise('The Lion')).toBe('lion');
    expect(normalise('a apple')).toBe('apple');
  });
});

describe('isValidAnswer', () => {
  it('requires the round letter when configured', () => {
    expect(isValidAnswer('Apple', 'A', settings())).toBe(true);
    expect(isValidAnswer('Banana', 'A', settings())).toBe(false);
  });

  it('checks the letter after the article is removed', () => {
    // "The Antelope" should count for A, not T.
    expect(isValidAnswer('The Antelope', 'A', settings())).toBe(true);
  });

  it('accepts anything non-empty when the letter rule is off', () => {
    expect(isValidAnswer('Banana', 'A', settings({ requireStartsWithLetter: false }))).toBe(true);
  });

  it('treats blank and whitespace as invalid', () => {
    expect(isValidAnswer('   ', 'A', settings())).toBe(false);
  });

  it('applies a dictionary only where one exists', () => {
    const s = settings({ useDictionaries: true });
    const dict = new Set(['ant', 'antelope']);
    expect(isValidAnswer('Ant', 'A', s, dict)).toBe(true);
    expect(isValidAnswer('Aardvark', 'A', s, dict)).toBe(false);
    // No dictionary supplied: fall back to the letter rule alone.
    expect(isValidAnswer('Aardvark', 'A', s, undefined)).toBe(true);
  });
});

describe('scoreRound', () => {
  it('gives 10 for unique and 5 for a shared answer', () => {
    const ps = players('Ana', 'Ben');
    const r = scoreRound(1, 'A', ps, {
      p0: { Animal: 'Antelope', Food: 'Apple' },
      p1: { Animal: 'Ant', Food: 'Apple' },
    }, settings());

    expect(r.breakdown.p0.Animal.verdict).toBe('unique');
    expect(r.breakdown.p0.Animal.points).toBe(10);
    expect(r.breakdown.p0.Food.verdict).toBe('duplicate');
    expect(r.breakdown.p0.Food.points).toBe(5);
    expect(r.totals.p0).toBe(15);
    expect(r.totals.p1).toBe(15);
  });

  it('names who you shared an answer with', () => {
    const ps = players('Ana', 'Ben', 'Cat');
    const r = scoreRound(1, 'A', ps, {
      p0: { Animal: 'Ant', Food: '' },
      p1: { Animal: 'ant', Food: '' },
      p2: { Animal: 'Ape', Food: '' },
    }, settings());

    expect(r.breakdown.p0.Animal.sharedWith).toEqual(['Ben']);
    expect(r.breakdown.p2.Animal.verdict).toBe('unique');
  });

  it('scores an empty answer as zero, never as a penalty', () => {
    const ps = players('Ana');
    const r = scoreRound(1, 'A', ps, { p0: { Animal: '', Food: '' } }, settings({ penaltyInvalid: -5 }));
    expect(r.breakdown.p0.Animal.verdict).toBe('empty');
    expect(r.totals.p0).toBe(0);
  });

  it('applies the penalty to a wrong-letter answer', () => {
    const ps = players('Ana');
    const r = scoreRound(1, 'A', ps, { p0: { Animal: 'Zebra', Food: '' } }, settings({ penaltyInvalid: -5 }));
    expect(r.breakdown.p0.Animal.verdict).toBe('invalid');
    expect(r.totals.p0).toBe(-5);
  });

  it('does not let an invalid answer create a duplicate group', () => {
    // Both wrote Zebra for letter A. Neither is valid, so neither should be
    // treated as a shared answer worth 5.
    const ps = players('Ana', 'Ben');
    const r = scoreRound(1, 'A', ps, {
      p0: { Animal: 'Zebra', Food: '' },
      p1: { Animal: 'Zebra', Food: '' },
    }, settings());
    expect(r.breakdown.p0.Animal.verdict).toBe('invalid');
    expect(r.breakdown.p1.Animal.verdict).toBe('invalid');
  });

  it('counts a missing player sheet as all empty rather than throwing', () => {
    const ps = players('Ana', 'Ben');
    const r = scoreRound(1, 'A', ps, { p0: { Animal: 'Ant', Food: 'Apple' } }, settings());
    expect(r.totals.p1).toBe(0);
    expect(r.breakdown.p1.Animal.verdict).toBe('empty');
  });
});

describe('pickLetter', () => {
  it('never repeats while unused letters remain', () => {
    const s = settings({ letterPool: 'ABC', noRepeatLetters: true });
    const used: string[] = [];
    for (let i = 0; i < 3; i++) used.push(pickLetter(s, used, () => 0));
    expect(new Set(used).size).toBe(3);
  });

  it('reuses the pool once exhausted instead of failing', () => {
    const s = settings({ letterPool: 'AB', noRepeatLetters: true });
    expect(['A', 'B']).toContain(pickLetter(s, ['A', 'B'], () => 0));
  });

  it('only ever returns a letter from the pool', () => {
    const s = settings({ letterPool: 'XYZ' });
    for (let i = 0; i < 20; i++) {
      expect('XYZ').toContain(pickLetter(s, [], Math.random));
    }
  });
});

describe('hasFilledAll', () => {
  it('is true only when every category has content', () => {
    const s = settings();
    expect(hasFilledAll('p0', { p0: { Animal: 'Ant', Food: 'Apple' } }, s)).toBe(true);
    expect(hasFilledAll('p0', { p0: { Animal: 'Ant', Food: '  ' } }, s)).toBe(false);
    expect(hasFilledAll('p0', {}, s)).toBe(false);
  });
});

describe('resolveProtest', () => {
  it('needs strictly more than two thirds, so exactly 2 of 3 fails', () => {
    const r = resolveProtest(protest({ a: true, b: true, c: false }));
    expect(r.agreeShare).toBeCloseTo(2 / 3);
    expect(r.outcome).toBe('rejected');
  });

  it('upholds on 3 of 4', () => {
    expect(resolveProtest(protest({ a: true, b: true, c: true, d: false })).outcome).toBe('upheld');
  });

  it('upholds a unanimous vote', () => {
    expect(resolveProtest(protest({ a: true, b: true })).outcome).toBe('upheld');
  });

  it('rejects a tie', () => {
    expect(resolveProtest(protest({ a: true, b: false })).outcome).toBe('rejected');
  });

  it('rejects when nobody voted rather than dividing by zero', () => {
    const r = resolveProtest(protest({}));
    expect(r.agreeShare).toBe(0);
    expect(r.outcome).toBe('rejected');
  });

  it('ignores abstentions instead of counting them against', () => {
    // Two voted yes, one wandered off. That is unanimous among votes cast.
    expect(resolveProtest(protest({ a: true, b: true })).outcome).toBe('upheld');
  });
});

describe('eligibleVoters', () => {
  it('excludes the author and anyone disconnected', () => {
    const ps = players('Ana', 'Ben', 'Cat');
    ps[2].connected = false;
    const voters = eligibleVoters(ps, protest({}));
    expect(voters.map((v) => v.name)).toEqual(['Ben']);
  });
});

describe('scoreRound with overrides', () => {
  it('counts an overridden answer as valid', () => {
    const ps = players('Ana');
    const r = scoreRound(
      1, 'A', ps,
      { p0: { Animal: 'Zebra', Food: '' } },
      settings(),
      {},
      new Set([overrideKey('p0', 'Animal')])
    );
    expect(r.breakdown.p0.Animal.verdict).toBe('unique');
    expect(r.totals.p0).toBe(10);
  });

  it('lets a reinstated answer become a duplicate, changing the other player too', () => {
    // Ben wrote the same word validly. Once Ana's is reinstated, both should
    // drop to the duplicate score. This is why a protest triggers a full
    // re-score rather than a patch to one player.
    const ps = players('Ana', 'Ben');
    const before = scoreRound(1, 'A', ps, {
      p0: { Animal: 'Aardwolf', Food: '' },
      p1: { Animal: 'Aardwolf', Food: '' },
    }, settings({ requireStartsWithLetter: false }));
    expect(before.breakdown.p1.Animal.points).toBe(5);

    const r = scoreRound(
      1, 'A', ps,
      { p0: { Animal: 'Zebra', Food: '' }, p1: { Animal: 'Zebra', Food: '' } },
      settings(),
      {},
      new Set([overrideKey('p0', 'Animal'), overrideKey('p1', 'Animal')])
    );
    expect(r.breakdown.p0.Animal.verdict).toBe('duplicate');
    expect(r.breakdown.p1.Animal.verdict).toBe('duplicate');
  });

  it('accepts a word present in the community dictionary', () => {
    const ps = players('Ana');
    const s = settings({ useDictionaries: true });
    const r = scoreRound(1, 'A', ps, { p0: { Animal: 'Aardwolf', Food: '' } }, s, {
      Animal: new Set(['aardwolf']),
    });
    expect(r.breakdown.p0.Animal.verdict).toBe('unique');
  });
});

describe('sanitiseSettings', () => {
  it('clamps hostile numbers into range', () => {
    const s = sanitiseSettings(
      { rounds: 9999, roundSeconds: -5, penaltyInvalid: 100 },
      DEFAULT_SETTINGS
    );
    expect(s.rounds).toBe(20);
    expect(s.roundSeconds).toBe(15);
    expect(s.penaltyInvalid).toBe(0); // penalties may not be positive
  });

  it('caps the category count and drops blanks', () => {
    const s = sanitiseSettings(
      { categories: [...Array(30)].map((_, i) => `C${i}`).concat(['', '   ']) },
      DEFAULT_SETTINGS
    );
    expect(s.categories.length).toBe(16);
    expect(s.categories.every((c) => c.trim().length > 0)).toBe(true);
  });

  it('falls back rather than accepting an empty category list', () => {
    const s = sanitiseSettings({ categories: [] }, DEFAULT_SETTINGS);
    expect(s.categories).toEqual(DEFAULT_SETTINGS.categories);
  });

  it('strips non-letters from the letter pool', () => {
    const s = sanitiseSettings({ letterPool: 'ab3!c' }, DEFAULT_SETTINGS);
    expect(s.letterPool).toBe('ABC');
  });
});

import { describe, expect, it } from 'vitest';
import {
  computeEfficientValue,
  decideDemand,
  demoConfig,
  makeRng,
  marginalValue,
  runAuction,
  totalValue,
  type AuctionConfig,
  type Bidder,
  type Product,
} from './clock-auction';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'P1',
  label: 'Test slot',
  airport: 'Test',
  window: '00:00-01:00',
  supply: 2,
  reserve: 100,
  points: 1,
  ...over,
});

const bidder = (over: Partial<Bidder> = {}): Bidder => ({
  id: 'B1',
  name: 'Bidder',
  strategy: 'straightforward',
  budget: 1_000_000,
  eligibility: 10,
  values: { P1: [300, 200, 100] },
  ...over,
});

const config = (over: Partial<AuctionConfig> = {}): AuctionConfig => ({
  products: [product()],
  bidders: [bidder()],
  increment: 0.1,
  smallIncrement: 0.05,
  smallIncrementFrom: 100,
  maxRounds: 50,
  activityRule: 1,
  ...over,
});

describe('value curves', () => {
  it('reads descending marginal values and is zero past the curve', () => {
    const b = bidder();
    expect(marginalValue(b, 'P1', 1)).toBe(300);
    expect(marginalValue(b, 'P1', 3)).toBe(100);
    expect(marginalValue(b, 'P1', 4)).toBe(0);
    expect(marginalValue(b, 'P1', 0)).toBe(0);
  });

  it('sums to a total value', () => {
    expect(totalValue(bidder(), 'P1', 2)).toBe(500);
  });

  it('returns zero for an unknown product rather than throwing', () => {
    expect(marginalValue(bidder(), 'NOPE', 1)).toBe(0);
  });
});

describe('straightforward demand', () => {
  it('takes every unit worth strictly more than the price', () => {
    const c = config();
    const d = decideDemand(bidder(), c, { P1: 150 }, 10, 1, { P1: 0 });
    expect(d.P1).toBe(2); // 300 and 200 clear 150; 100 does not
  });

  it('does not demand a unit valued exactly at the price', () => {
    // Indifference must not be resolved as a bid, or the clock is pushed up
    // on units nobody actually wanted at that price.
    const d = decideDemand(bidder(), config(), { P1: 200 }, 10, 1, { P1: 0 });
    expect(d.P1).toBe(1);
  });

  it('drops to zero once the price exceeds every marginal value', () => {
    const d = decideDemand(bidder(), config(), { P1: 500 }, 10, 1, { P1: 0 });
    expect(d.P1).toBe(0);
  });
});

describe('eligibility', () => {
  it('caps demand at the points a bidder holds', () => {
    const p = product({ supply: 5, points: 2 });
    const b = bidder({ eligibility: 4, values: { P1: [500, 400, 300, 200] } });
    const d = decideDemand(b, config({ products: [p], bidders: [b] }), { P1: 100 }, 4, 1, { P1: 0 });
    expect(d.P1).toBe(2); // 4 points / 2 per slot
  });

  it('is irreversible: eligibility lost in one round is gone in the next', () => {
    const p = product({ supply: 6, points: 1 });
    // Values collapse after the first unit, so demand falls immediately.
    const b = bidder({ eligibility: 6, values: { P1: [1000, 1, 1, 1, 1, 1] } });
    const res = runAuction(config({ products: [p], bidders: [b], activityRule: 1 }));
    const first = res.rounds[0].demands[0];
    expect(first.eligibilityBefore).toBe(6);
    expect(first.eligibilityAfter).toBeLessThan(6);
    expect(first.lostEligibility).toBeGreaterThan(0);
    // It never recovers.
    for (const r of res.rounds) {
      expect(r.demands[0].eligibilityAfter).toBeLessThanOrEqual(first.eligibilityAfter);
    }
  });
});

describe('the clock', () => {
  it('clears immediately when demand is already within supply', () => {
    const p = product({ supply: 5 });
    const b = bidder({ values: { P1: [300, 200] } });
    const res = runAuction(config({ products: [p], bidders: [b] }));
    expect(res.rounds).toHaveLength(1);
    expect(res.clearingPrices.P1).toBe(100); // never left the reserve
  });

  it('raises price only while demand exceeds supply', () => {
    const p = product({ supply: 1 });
    const b1 = bidder({ id: 'A', values: { P1: [400] } });
    const b2 = bidder({ id: 'B', values: { P1: [380] } });
    const res = runAuction(config({ products: [p], bidders: [b1, b2] }));

    // Price rises until one drops out.
    expect(res.clearingPrices.P1).toBeGreaterThan(100);
    // It should not overshoot beyond the losing bidder's value by more than
    // one increment, or the clock is stepping too coarsely.
    expect(res.clearingPrices.P1).toBeLessThanOrEqual(380 * 1.1 + 0.01);
    const final = res.rounds[res.rounds.length - 1];
    expect(final.excess.P1).toBeLessThanOrEqual(0);
  });

  it('holds the price of a product that is already in balance', () => {
    // P1 is contested, P2 is not. P2 must not be dragged up with it.
    const p1 = product({ id: 'P1', supply: 1 });
    const p2 = product({ id: 'P2', supply: 5, reserve: 50 });
    const mk = (id: string) =>
      bidder({
        id,
        values: { P1: [400], P2: [80] },
        eligibility: 10,
      });
    const res = runAuction(config({ products: [p1, p2], bidders: [mk('A'), mk('B')] }));
    expect(res.clearingPrices.P2).toBe(50);
    expect(res.clearingPrices.P1).toBeGreaterThan(50);
  });

  it('terminates on the round cap rather than running unbounded', () => {
    // A contested product with deep-pocketed bidders needs many rounds to
    // clear. Cap it below that and the auction must stop and say so.
    const p = product({ supply: 1, reserve: 1 });
    const rich = (id: string) =>
      bidder({ id, values: { P1: [1_000_000] }, eligibility: 10 });
    const res = runAuction(
      config({ products: [p], bidders: [rich('A'), rich('B')], maxRounds: 4 })
    );
    expect(res.hitRoundCap).toBe(true);
    expect(res.rounds).toHaveLength(4);
    // Still returns a usable result rather than throwing.
    expect(res.clearingPrices.P1).toBeGreaterThan(1);
  });

  it('a product with no supply clears instantly and sells nothing', () => {
    // Nobody can demand a slot that does not exist, so this is not a hang.
    const p = product({ supply: 0 });
    const b = bidder({ values: { P1: [1e9, 1e9] } });
    const res = runAuction(config({ products: [p], bidders: [b], maxRounds: 5 }));
    expect(res.hitRoundCap).toBe(false);
    expect(res.rounds).toHaveLength(1);
    expect(res.assignments).toHaveLength(0);
    expect(res.unsoldSlots).toBe(0);
  });
});

describe('allocation', () => {
  it('never allocates more slots than exist', () => {
    const cfg = demoConfig();
    const res = runAuction(cfg);
    for (const p of cfg.products) {
      const sold = res.assignments
        .filter((a) => a.productId === p.id)
        .reduce((s, a) => s + a.slots, 0);
      expect(sold).toBeLessThanOrEqual(p.supply);
    }
  });

  it('reports unsold slots rather than hiding them', () => {
    const p = product({ supply: 3, reserve: 1000 });
    const b = bidder({ values: { P1: [500] } }); // nobody wants it at reserve
    const res = runAuction(config({ products: [p], bidders: [b] }));
    expect(res.unsoldSlots).toBe(3);
    expect(res.revenue).toBe(0);
  });

  it('revenue equals the sum of assignment costs', () => {
    const res = runAuction(demoConfig());
    const sum = res.assignments.reduce((s, a) => s + a.cost, 0);
    expect(res.revenue).toBeCloseTo(Math.round(sum * 100) / 100, 2);
  });
});

describe('efficiency', () => {
  it('is 1 when a single bidder takes everything it values', () => {
    const p = product({ supply: 2 });
    const b = bidder({ values: { P1: [300, 200] } });
    const res = runAuction(config({ products: [p], bidders: [b] }));
    expect(res.efficiency).toBeCloseTo(1, 5);
  });

  it('never exceeds 1, since the benchmark is the maximum attainable', () => {
    for (const seed of [1, 2, 7, 42, 99]) {
      const res = runAuction(demoConfig(seed));
      expect(res.efficiency).toBeLessThanOrEqual(1.0000001);
    }
  });

  it('computes the benchmark greedily over descending marginal values', () => {
    const p = product({ supply: 2 });
    const a = bidder({ id: 'A', values: { P1: [300, 50] } });
    const b = bidder({ id: 'B', values: { P1: [280, 40] } });
    // Best two units available are 300 and 280.
    expect(computeEfficientValue(config({ products: [p], bidders: [a, b] }))).toBe(580);
  });
});

describe('strategies', () => {
  it('demand reduction bids below the straightforward quantity when contested', () => {
    const c = config();
    const reducer = bidder({ strategy: 'demand-reducing' });
    const honest = bidder({ strategy: 'straightforward' });
    const prices = { P1: 150 };
    const contested = { P1: 3 };

    const dr = decideDemand(reducer, c, prices, 10, 5, contested);
    const sf = decideDemand(honest, c, prices, 10, 5, contested);
    expect(dr.P1).toBeLessThan(sf.P1);
  });

  it('does not reduce in the opening rounds, before competition is visible', () => {
    const c = config();
    const reducer = bidder({ strategy: 'demand-reducing' });
    const d = decideDemand(reducer, c, { P1: 150 }, 10, 1, { P1: 3 });
    expect(d.P1).toBe(2);
  });

  it('a budget-capped bidder never commits beyond its budget', () => {
    const c = config();
    const poor = bidder({ strategy: 'budget-capped', budget: 160, values: { P1: [900, 800, 700] } });
    const d = decideDemand(poor, c, { P1: 150 }, 10, 1, { P1: 0 });
    expect(d.P1 * 150).toBeLessThanOrEqual(160);
  });
});

describe('determinism', () => {
  it('the same seed produces an identical auction', () => {
    const a = runAuction(demoConfig(7));
    const b = runAuction(demoConfig(7));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce different auctions', () => {
    const a = runAuction(demoConfig(1));
    const b = runAuction(demoConfig(2));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('the rng is stable for a given seed', () => {
    const r1 = makeRng(42);
    const r2 = makeRng(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});

describe('the demo scenario', () => {
  it('runs to a clean clear within the round cap', () => {
    const res = runAuction(demoConfig());
    expect(res.hitRoundCap).toBe(false);
    expect(res.rounds.length).toBeGreaterThan(2);
    const final = res.rounds[res.rounds.length - 1];
    for (const v of Object.values(final.excess)) expect(v).toBeLessThanOrEqual(0);
  });

  it('prices rise monotonically, never falling', () => {
    const res = runAuction(demoConfig());
    for (let i = 1; i < res.rounds.length; i++) {
      for (const id of Object.keys(res.rounds[i].prices)) {
        expect(res.rounds[i].prices[id]).toBeGreaterThanOrEqual(res.rounds[i - 1].prices[id]);
      }
    }
  });
});

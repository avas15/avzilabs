/**
 * Ascending clock auction engine.
 *
 * Domain is airport landing-slot allocation, the same structural analogue used
 * by the data platform demo. Slots at an airport in a time window are the
 * product; carriers are the bidders.
 *
 * The engine is pure: given a configuration and a bid history it produces the
 * same auction every time. No clock, no IO, no randomness that is not seeded.
 * That is what makes it testable, and an auction engine you cannot test is an
 * auction engine you should not trust.
 *
 * The rules implemented are the standard ascending clock package: per-product
 * clock prices, aggregate demand, price increases only where there is excess
 * demand, and a monotone eligibility rule that makes reducing demand
 * irreversible. That last rule is what turns the format from a price discovery
 * exercise into a strategic one.
 */

export interface Product {
  id: string;
  label: string;
  airport: string;
  window: string;
  /** Slots available. */
  supply: number;
  /** Opening price per slot. */
  reserve: number;
  /** Eligibility points per slot, usually proportional to how prized it is. */
  points: number;
}

export type Strategy = 'straightforward' | 'demand-reducing' | 'budget-capped';

export interface Bidder {
  id: string;
  name: string;
  strategy: Strategy;
  /** Marginal value per additional slot, per product. Descending. */
  values: Record<string, number[]>;
  /** Total spend cap across the auction. */
  budget: number;
  /** Opening eligibility in points. */
  eligibility: number;
}

export interface AuctionConfig {
  products: Product[];
  bidders: Bidder[];
  /** Fractional clock increment on products with excess demand, e.g. 0.1. */
  increment: number;
  /**
   * Increment applied once a product has been in excess demand for a while.
   * Smaller steps near the end reduce overshoot past the clearing price.
   */
  smallIncrement: number;
  /** Round after which the smaller increment applies. */
  smallIncrementFrom: number;
  /** Hard stop, so a misconfigured auction cannot loop forever. */
  maxRounds: number;
  /**
   * Activity requirement. A bidder must use at least this share of their
   * eligibility each round or lose the difference.
   */
  activityRule: number;
}

export interface RoundDemand {
  bidderId: string;
  /** productId -> slots demanded */
  demand: Record<string, number>;
  pointsUsed: number;
  eligibilityBefore: number;
  eligibilityAfter: number;
  /** Set when the activity rule cost them eligibility they did not spend. */
  lostEligibility: number;
}

export interface Round {
  number: number;
  /** productId -> clock price at which demand was stated */
  prices: Record<string, number>;
  demands: RoundDemand[];
  /** productId -> total slots demanded */
  aggregate: Record<string, number>;
  /** productId -> demand minus supply, negative meaning spare capacity */
  excess: Record<string, number>;
  /** Products whose price will rise next round. */
  rising: string[];
}

export interface Assignment {
  bidderId: string;
  productId: string;
  slots: number;
  pricePerSlot: number;
  cost: number;
}

export interface AuctionResult {
  rounds: Round[];
  /** Price each product cleared at. */
  clearingPrices: Record<string, number>;
  assignments: Assignment[];
  revenue: number;
  /** Sum of winners' marginal values for what they won. */
  realisedValue: number;
  /** Best achievable total value, ignoring prices. */
  efficientValue: number;
  /** realisedValue / efficientValue. 1 means fully efficient. */
  efficiency: number;
  /** True if the clock stopped because it hit maxRounds. */
  hitRoundCap: boolean;
  unsoldSlots: number;
}

// --------------------------------------------------------------------- utils

/** Deterministic PRNG so a given seed always reproduces the same auction. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Marginal value of the nth slot (1-indexed). Zero past the value curve. */
export function marginalValue(bidder: Bidder, productId: string, n: number): number {
  const curve = bidder.values[productId];
  if (!curve || n < 1 || n > curve.length) return 0;
  return curve[n - 1];
}

/** Total value of taking `q` slots of a product. */
export function totalValue(bidder: Bidder, productId: string, q: number): number {
  let sum = 0;
  for (let i = 1; i <= q; i++) sum += marginalValue(bidder, productId, i);
  return sum;
}

// ------------------------------------------------------------------ bidding

/**
 * Quantity a straightforward bidder wants at the current price: every slot
 * whose marginal value strictly exceeds the price.
 *
 * Strictly, not weakly. At exactly the price a bidder is indifferent, and
 * assuming they take it silently biases the clearing price upward.
 */
function straightforwardQuantity(bidder: Bidder, p: Product, price: number): number {
  let q = 0;
  for (let i = 1; i <= p.supply; i++) {
    if (marginalValue(bidder, p.id, i) > price) q++;
    else break;
  }
  return q;
}

/**
 * Decide one bidder's demand for a round.
 *
 * Three behaviours, because the interesting output of a clock auction is how
 * differently these three do against each other:
 *
 * - straightforward: demand what is profitable at the current price. Truthful,
 *   and the benchmark the theory is written against.
 * - demand-reducing: deliberately demand less than profitable once the auction
 *   looks tight, to slow the clock. Individually rational, collectively
 *   inefficient, and the central strategic problem of multi-unit auctions.
 * - budget-capped: wants more than it can pay for, so it prioritises by
 *   surplus per pound until the budget binds.
 */
export function decideDemand(
  bidder: Bidder,
  config: AuctionConfig,
  prices: Record<string, number>,
  eligibility: number,
  roundNumber: number,
  previousExcess: Record<string, number>
): Record<string, number> {
  const wanted: Record<string, number> = {};

  for (const p of config.products) {
    const price = prices[p.id];
    let q = straightforwardQuantity(bidder, p, price);

    if (bidder.strategy === 'demand-reducing') {
      /*
        Reduce once competition is visible but before the price has run away.
        A real bidder does this to avoid being the one who pushes the clock
        up on units they were going to win anyway.
      */
      const contested = (previousExcess[p.id] ?? 0) > 0;
      if (contested && roundNumber > 2 && q > 1) q -= 1;
    }

    wanted[p.id] = q;
  }

  if (bidder.strategy === 'budget-capped') {
    /*
      Spend is committed if the auction clears here, so evaluate against the
      current clock. Drop the worst surplus-per-pound unit until affordable.
    */
    const cost = () =>
      config.products.reduce((s, p) => s + wanted[p.id] * prices[p.id], 0);

    let guard = 0;
    while (cost() > bidder.budget && guard++ < 500) {
      let worstId: string | null = null;
      let worstRatio = Infinity;
      for (const p of config.products) {
        const q = wanted[p.id];
        if (q <= 0) continue;
        const mv = marginalValue(bidder, p.id, q);
        const ratio = (mv - prices[p.id]) / Math.max(prices[p.id], 1e-9);
        if (ratio < worstRatio) {
          worstRatio = ratio;
          worstId = p.id;
        }
      }
      if (!worstId) break;
      wanted[worstId] -= 1;
    }
  }

  // Eligibility binds last: you cannot bid for more than you are entitled to.
  const pointsFor = (d: Record<string, number>) =>
    config.products.reduce((s, p) => s + d[p.id] * p.points, 0);

  let guard = 0;
  while (pointsFor(wanted) > eligibility && guard++ < 1000) {
    // Shed the least valuable unit first.
    let worstId: string | null = null;
    let worstSurplus = Infinity;
    for (const p of config.products) {
      const q = wanted[p.id];
      if (q <= 0) continue;
      const surplus = marginalValue(bidder, p.id, q) - prices[p.id];
      if (surplus < worstSurplus) {
        worstSurplus = surplus;
        worstId = p.id;
      }
    }
    if (!worstId) break;
    wanted[worstId] -= 1;
  }

  return wanted;
}

// ------------------------------------------------------------------- engine

export function runAuction(config: AuctionConfig): AuctionResult {
  const prices: Record<string, number> = {};
  for (const p of config.products) prices[p.id] = p.reserve;

  const eligibility: Record<string, number> = {};
  for (const b of config.bidders) eligibility[b.id] = b.eligibility;

  const rounds: Round[] = [];
  let previousExcess: Record<string, number> = {};
  for (const p of config.products) previousExcess[p.id] = 0;

  let hitRoundCap = false;

  for (let n = 1; n <= config.maxRounds; n++) {
    const demands: RoundDemand[] = [];
    const aggregate: Record<string, number> = {};
    for (const p of config.products) aggregate[p.id] = 0;

    for (const b of config.bidders) {
      const before = eligibility[b.id];
      const demand = decideDemand(b, config, prices, before, n, previousExcess);
      const pointsUsed = config.products.reduce(
        (s, p) => s + demand[p.id] * p.points,
        0
      );

      /*
        Monotone eligibility. Unused entitlement is lost permanently, not
        merely unused this round. This is what makes early demand reduction
        a real commitment rather than a free option, and it is the single
        rule that most changes how the format plays.
      */
      const required = before * config.activityRule;
      let after = before;
      let lost = 0;
      if (pointsUsed < required) {
        after = Math.floor(pointsUsed / Math.max(config.activityRule, 1e-9));
        after = Math.min(before, Math.max(pointsUsed, after));
        lost = before - after;
      }
      eligibility[b.id] = after;

      for (const p of config.products) aggregate[p.id] += demand[p.id];
      demands.push({
        bidderId: b.id,
        demand,
        pointsUsed,
        eligibilityBefore: before,
        eligibilityAfter: after,
        lostEligibility: lost,
      });
    }

    const excess: Record<string, number> = {};
    const rising: string[] = [];
    for (const p of config.products) {
      excess[p.id] = aggregate[p.id] - p.supply;
      if (excess[p.id] > 0) rising.push(p.id);
    }

    rounds.push({
      number: n,
      prices: { ...prices },
      demands,
      aggregate: { ...aggregate },
      excess: { ...excess },
      rising: [...rising],
    });

    // Clear when nothing is over-subscribed.
    if (rising.length === 0) {
      return finalise(config, rounds, prices, false);
    }

    // Raise only the products with excess demand. Products already in balance
    // hold their price; raising them would break the clearing they reached.
    const step = n >= config.smallIncrementFrom ? config.smallIncrement : config.increment;
    for (const id of rising) prices[id] = round2(prices[id] * (1 + step));

    previousExcess = excess;

    if (n === config.maxRounds) hitRoundCap = true;
  }

  return finalise(config, rounds, prices, hitRoundCap);
}

/**
 * Turn the final round into an allocation.
 *
 * When demand exactly meets supply the assignment is simply the final demand.
 * Where the clock overshot and a product is under-subscribed, the slots go to
 * whoever still wants them at the final price; any remainder is unsold, which
 * is a real outcome and should be visible rather than hidden.
 */
function finalise(
  config: AuctionConfig,
  rounds: Round[],
  prices: Record<string, number>,
  hitRoundCap: boolean
): AuctionResult {
  const last = rounds[rounds.length - 1];
  const assignments: Assignment[] = [];
  let revenue = 0;
  let realisedValue = 0;
  let unsoldSlots = 0;

  for (const p of config.products) {
    let remaining = p.supply;
    // Highest marginal value first, which is how a tie at the clock price
    // would be broken in practice by a supplementary or a random draw.
    const claims = last.demands
      .map((d) => ({
        bidderId: d.bidderId,
        want: d.demand[p.id],
        strength: marginalValue(
          config.bidders.find((b) => b.id === d.bidderId)!,
          p.id,
          1
        ),
      }))
      .filter((c) => c.want > 0)
      .sort((a, b) => b.strength - a.strength);

    for (const c of claims) {
      if (remaining <= 0) break;
      const slots = Math.min(c.want, remaining);
      remaining -= slots;
      const cost = round2(slots * prices[p.id]);
      revenue += cost;
      const bidder = config.bidders.find((b) => b.id === c.bidderId)!;
      realisedValue += totalValue(bidder, p.id, slots);
      assignments.push({
        bidderId: c.bidderId,
        productId: p.id,
        slots,
        pricePerSlot: prices[p.id],
        cost,
      });
    }
    unsoldSlots += remaining;
  }

  const efficientValue = computeEfficientValue(config);

  return {
    rounds,
    clearingPrices: { ...prices },
    assignments,
    revenue: round2(revenue),
    realisedValue: round2(realisedValue),
    efficientValue: round2(efficientValue),
    efficiency: efficientValue > 0 ? realisedValue / efficientValue : 1,
    hitRoundCap,
    unsoldSlots,
  };
}

/**
 * Maximum total value obtainable, ignoring prices and eligibility.
 *
 * Products are independent here and marginal values are descending, so the
 * greedy assignment of the highest remaining marginal values is optimal. That
 * would not hold with package complementarities, which is exactly why a
 * combinatorial format needs a real solver instead.
 */
export function computeEfficientValue(config: AuctionConfig): number {
  let total = 0;
  for (const p of config.products) {
    const pool: number[] = [];
    for (const b of config.bidders) {
      for (let i = 1; i <= p.supply; i++) {
        const mv = marginalValue(b, p.id, i);
        if (mv > 0) pool.push(mv);
      }
    }
    pool.sort((a, b) => b - a);
    total += pool.slice(0, p.supply).reduce((s, v) => s + v, 0);
  }
  return total;
}

// ------------------------------------------------------------------ presets

/** A scenario tuned so the interesting behaviour is visible in a few rounds. */
export function demoConfig(seed = 7): AuctionConfig {
  const rng = makeRng(seed);
  const jitter = (base: number, spread: number) =>
    Math.round(base * (1 + (rng() - 0.5) * spread));

  const products: Product[] = [
    { id: 'LHR-AM', label: 'Heathmoor, morning peak', airport: 'Heathmoor', window: '06:00-09:00', supply: 4, reserve: 100, points: 3 },
    { id: 'LHR-MD', label: 'Heathmoor, midday', airport: 'Heathmoor', window: '11:00-14:00', supply: 5, reserve: 60, points: 2 },
    { id: 'NOR-AM', label: 'Northgate, morning peak', airport: 'Northgate', window: '06:00-09:00', supply: 3, reserve: 70, points: 2 },
  ];

  const curve = (top: number, n: number, decay: number) =>
    Array.from({ length: n }, (_, i) => jitter(top * Math.pow(decay, i), 0.08));

  const bidders: Bidder[] = [
    {
      id: 'AV', name: 'Aviora', strategy: 'straightforward', budget: 100000, eligibility: 22,
      values: { 'LHR-AM': curve(420, 4, 0.78), 'LHR-MD': curve(150, 4, 0.8), 'NOR-AM': curve(190, 3, 0.75) },
    },
    {
      id: 'MR', name: 'Meridian Air', strategy: 'demand-reducing', budget: 100000, eligibility: 22,
      values: { 'LHR-AM': curve(390, 4, 0.8), 'LHR-MD': curve(170, 4, 0.82), 'NOR-AM': curve(160, 3, 0.78) },
    },
    {
      id: 'KS', name: 'Kestrel', strategy: 'budget-capped', budget: 1900, eligibility: 18,
      values: { 'LHR-AM': curve(460, 3, 0.76), 'LHR-MD': curve(140, 3, 0.8), 'NOR-AM': curve(210, 3, 0.72) },
    },
    {
      id: 'PT', name: 'Petrel Connect', strategy: 'straightforward', budget: 100000, eligibility: 14,
      values: { 'LHR-AM': curve(300, 3, 0.8), 'LHR-MD': curve(190, 4, 0.85), 'NOR-AM': curve(150, 2, 0.8) },
    },
  ];

  return {
    products,
    bidders,
    increment: 0.12,
    smallIncrement: 0.04,
    smallIncrementFrom: 8,
    maxRounds: 40,
    activityRule: 0.9,
  };
}

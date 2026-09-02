/**
 * SENT — market state projection.
 *
 * §138: the chain is the only financial authority and this projection is
 * rebuildable. That is a strong claim — it means replaying every event from
 * genesis must reproduce the contract's own state exactly, not approximately.
 *
 * So the reducer is pure. It takes decoded events and produces state, with no
 * database, no RPC and no clock. `sim/projection.ts` drives it with events
 * captured from REAL contract execution and asserts the result equals what the
 * contract reports about itself.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It never recomputes economics. Fees and curve output arrive in the events
 * because the contract already computed them (§423 event wiring), and recomputing
 * here would be a second implementation of fee math — precisely what §1064
 * forbids, and precisely how a projection starts disagreeing with the chain.
 *
 * If a number is not in an event, it does not belong in this projection.
 */

export type MarketStatus = "PRE_GRAD" | "GRADUATING" | "GRADUATED";

/** Decoded `LaunchMarket.Bought`. */
export interface BoughtEvent {
  readonly type: "Bought";
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly buyer: string;
  readonly grossQuoteIn: bigint;
  readonly netToCurve: bigint;
  readonly tokensOut: bigint;
  readonly coreFee: bigint;
  readonly stockback: bigint;
  readonly newDistributed: bigint;
  readonly newCollateral: bigint;
}

/** Decoded `LaunchMarket.Sold`. */
export interface SoldEvent {
  readonly type: "Sold";
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly seller: string;
  readonly tokensIn: bigint;
  readonly grossQuoteOut: bigint;
  readonly netQuoteOut: bigint;
  readonly coreFee: bigint;
  readonly stockback: bigint;
  readonly newDistributed: bigint;
  readonly newCollateral: bigint;
}

/** Decoded `LaunchMarket.Graduated`. */
export interface GraduatedEvent {
  readonly type: "Graduated";
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly token: string;
  readonly pool: string;
  readonly positionId: bigint;
  readonly tokenAmount: bigint;
  readonly quoteAmount: bigint;
}

export type MarketEvent = BoughtEvent | SoldEvent | GraduatedEvent;

export interface MarketProjection {
  status: MarketStatus;
  distributed: bigint;
  curveCollateral: bigint;

  tradeCount: number;
  buyCount: number;
  sellCount: number;

  /** Gross notional on each side. The fee basis, per §9/§10. */
  buyVolume: bigint;
  sellVolume: bigint;

  cumulativeCoreFees: bigint;
  cumulativeStockback: bigint;

  pool: string | null;
  positionId: bigint | null;

  lastBlock: bigint;
  /** Per-account balances, the TWAB input. */
  balances: Map<string, bigint>;
}

export function emptyProjection(): MarketProjection {
  return {
    status: "PRE_GRAD",
    distributed: 0n,
    curveCollateral: 0n,
    tradeCount: 0,
    buyCount: 0,
    sellCount: 0,
    buyVolume: 0n,
    sellVolume: 0n,
    cumulativeCoreFees: 0n,
    cumulativeStockback: 0n,
    pool: null,
    positionId: null,
    lastBlock: 0n,
    balances: new Map(),
  };
}

/**
 * Fold one event into the projection.
 *
 * `distributed` and `curveCollateral` are TAKEN from the event, not derived. The
 * contract publishes its post-trade state precisely so a projection never has to
 * re-run the curve — and so a divergence between them is detectable rather than
 * baked in.
 */
export function applyEvent(state: MarketProjection, event: MarketEvent): MarketProjection {
  if (event.blockNumber < state.lastBlock) {
    throw new Error(
      `applyEvent: event from block ${event.blockNumber} arrived after ${state.lastBlock}; ` +
        "the caller must roll back before replaying",
    );
  }

  switch (event.type) {
    case "Bought": {
      state.distributed = event.newDistributed;
      state.curveCollateral = event.newCollateral;
      state.buyVolume += event.grossQuoteIn;
      state.cumulativeCoreFees += event.coreFee;
      state.cumulativeStockback += event.stockback;
      state.buyCount += 1;
      state.tradeCount += 1;
      credit(state.balances, event.buyer, event.tokensOut);
      break;
    }

    case "Sold": {
      state.distributed = event.newDistributed;
      state.curveCollateral = event.newCollateral;
      state.sellVolume += event.grossQuoteOut;
      state.cumulativeCoreFees += event.coreFee;
      state.cumulativeStockback += event.stockback;
      state.sellCount += 1;
      state.tradeCount += 1;
      credit(state.balances, event.seller, -event.tokensIn);
      break;
    }

    case "Graduated": {
      // The market's own accounting zeroes collateral on migration (§14 step 10):
      // it stops being a curve liability and becomes locked LP principal.
      state.status = "GRADUATED";
      state.curveCollateral = 0n;
      state.pool = event.pool.toLowerCase();
      state.positionId = event.positionId;
      break;
    }
  }

  state.lastBlock = event.blockNumber;
  return state;
}

function credit(balances: Map<string, bigint>, account: string, delta: bigint): void {
  const key = account.toLowerCase();
  const next = (balances.get(key) ?? 0n) + delta;

  if (next < 0n) {
    throw new Error(`credit: negative balance for ${key}; the event stream is incomplete`);
  }

  if (next === 0n) balances.delete(key);
  else balances.set(key, next);
}

/**
 * Replay a whole event stream.
 *
 * Events must be ordered by (block, logIndex) — the chain's own ordering. Sorting
 * here rather than trusting the caller makes a full reindex deterministic no
 * matter what order the log query returned.
 */
export function project(events: readonly MarketEvent[]): MarketProjection {
  const ordered = [...events].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });

  const state = emptyProjection();
  for (const event of ordered) applyEvent(state, event);
  return state;
}

/** Holders with a positive balance. Excluded addresses are filtered downstream. */
export function holderCount(state: MarketProjection): number {
  let count = 0;
  for (const balance of state.balances.values()) if (balance > 0n) count += 1;
  return count;
}

/**
 * Total TOKEN accounted for by the projection.
 *
 * Must always equal `distributed`: every token released by the curve is held by
 * somebody. A mismatch means an event was missed, and missing a Transfer is how
 * Stockback quietly starts paying the wrong people.
 */
export function totalHeld(state: MarketProjection): bigint {
  let total = 0n;
  for (const balance of state.balances.values()) total += balance;
  return total;
}

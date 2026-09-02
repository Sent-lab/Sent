/**
 * SENT — OHLCV aggregation.
 *
 * Pure. Trades in, candles out, no clock and no database — which is what lets
 * the awkward cases below be tested directly rather than inferred from a chart
 * that looks wrong.
 *
 * PRICES ARE INTEGERS ALL THE WAY THROUGH (§424)
 * ----------------------------------------------
 * Every value here is a BigInt in the market's own quote units. Nothing is
 * divided, averaged or normalised. A chart that renders a price is free to
 * convert for display; an aggregate that is stored must not, because a candle is
 * read back as a number a user compares against their fill.
 *
 * A CANDLE OPENS WHERE THE MARKET ALREADY WAS
 * -------------------------------------------
 * `open` is the price left by the previous trade, not the price after this
 * bucket's first trade. Using the latter is the common shortcut and it hides
 * exactly the move a candle exists to show: the first trade of a bucket that
 * doubles the price would render as a flat candle at the new price, and the jump
 * would vanish from the chart entirely.
 *
 * Consequently the FIRST bucket of a market's life has no prior price, and there
 * its own first trade is the only honest opening value.
 */

import type { TradePoint } from "@sent/database";

/** Intervals the API serves. Seconds, because that is what the schema stores. */
export const CANDLE_INTERVALS = [60, 300, 900, 3_600, 14_400, 86_400] as const;

export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export interface Candle {
  readonly intervalSeconds: number;
  /** Unix seconds, floored to the interval. */
  readonly bucket: number;
  readonly open: bigint;
  readonly high: bigint;
  readonly low: bigint;
  readonly close: bigint;
  /** Quote-unit notional traded in the bucket. */
  readonly volume: bigint;
  readonly tradeCount: number;
}

/**
 * Aggregate one interval.
 *
 * `priorPrice` is the market price immediately before the first trade given, or
 * null if this is the market's first trade ever.
 *
 * Empty buckets are NOT emitted. A period with no trades has no volume and no
 * range, and writing a flat candle for it would fabricate a data point — the
 * consumer knows how to draw a gap, and the schema has no way to say "this row
 * is synthetic".
 */
export function aggregate(
  trades: readonly TradePoint[],
  intervalSeconds: number,
  priorPrice: bigint | null,
): Candle[] {
  if (intervalSeconds <= 0) {
    throw new RangeError(`aggregate: interval must be positive, got ${intervalSeconds}`);
  }

  const candles: Candle[] = [];

  let current: {
    bucket: number;
    open: bigint;
    high: bigint;
    low: bigint;
    close: bigint;
    volume: bigint;
    tradeCount: number;
  } | null = null;

  // Carries across buckets so a gap does not reset the opening price.
  let previousClose = priorPrice;

  for (const trade of trades) {
    const bucket = Math.floor(trade.timestamp / intervalSeconds) * intervalSeconds;

    if (current !== null && bucket !== current.bucket) {
      candles.push({ intervalSeconds, ...current });
      previousClose = current.close;
      current = null;
    }

    if (current === null) {
      // No prior price only at the very start of a market's history.
      const open: bigint = previousClose ?? trade.priceAfter;

      current = {
        bucket,
        open,
        // The open participates in the range. A bucket whose only trade moved
        // the price DOWN has its high at the open, and a high taken from trades
        // alone would silently clip it.
        high: open > trade.priceAfter ? open : trade.priceAfter,
        low: open < trade.priceAfter ? open : trade.priceAfter,
        close: trade.priceAfter,
        volume: trade.notional,
        tradeCount: 1,
      };
      continue;
    }

    current = {
      bucket: current.bucket,
      open: current.open,
      high: trade.priceAfter > current.high ? trade.priceAfter : current.high,
      low: trade.priceAfter < current.low ? trade.priceAfter : current.low,
      close: trade.priceAfter,
      volume: current.volume + trade.notional,
      tradeCount: current.tradeCount + 1,
    };
  }

  if (current !== null) candles.push({ intervalSeconds, ...current });

  return candles;
}

/** Aggregate every interval from one pass of trades. */
export function aggregateAll(
  trades: readonly TradePoint[],
  priorPrice: bigint | null,
  intervals: readonly number[] = CANDLE_INTERVALS,
): Candle[] {
  return intervals.flatMap((interval) => aggregate(trades, interval, priorPrice));
}

/**
 * The window a candle job must recompute to include `timestamp`.
 *
 * Returned as the bucket boundaries rather than the raw timestamp, because a job
 * that recomputed a partial bucket would write a candle missing the trades on
 * either side of its own window — and being idempotent would then mean
 * repeatedly writing the same wrong value.
 */
export function bucketWindow(
  timestamp: number,
  intervalSeconds: number,
): { from: number; to: number } {
  const from = Math.floor(timestamp / intervalSeconds) * intervalSeconds;
  return { from, to: from + intervalSeconds };
}

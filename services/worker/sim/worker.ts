/**
 * SENT — worker simulation.
 *
 * Covers the three things that make background work trustworthy rather than
 * merely present:
 *
 *   1. Candles describe what happened. Not approximately — a candle is a number
 *      a user compares against their own fill.
 *   2. Job identifiers are deterministic, because the id IS the idempotency key.
 *   3. Retry is bounded and the boundary is where it claims to be.
 *
 * The handlers themselves need a database and are covered by the integration
 * fixture; everything decided WITHOUT one is decided here.
 */

import type { TradePoint } from "@sent/database";

import { aggregate, aggregateAll, bucketWindow, CANDLE_INTERVALS } from "../src/candles.ts";
import {
  backoffSeconds,
  retryDecision,
  logLine,
  DEFAULT_RUNNER_CONFIG,
} from "../src/runner.ts";
import {
  candleJobId,
  holderJobId,
  healthJobId,
  analyticsJobId,
  JOB_KINDS,
} from "../src/schedule.ts";

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

function trade(timestamp: number, priceAfter: bigint, notional: bigint): TradePoint {
  return { timestamp, priceAfter, notional };
}

const MARKET = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";

// ---------------------------------------------------------------------------

section("Candles describe the move, not just the settled price");

{
  // One bucket, one trade that doubled the price. The classic wrong answer is a
  // flat candle at 200 — open, high, low and close all equal — which erases the
  // single most important thing that happened in the period.
  const candles = aggregate([trade(60, 200n, 1_000n)], 60, 100n);

  check("one candle emitted", candles.length === 1);
  check("opens at the prior price", candles[0]?.open === 100n);
  check("closes at the traded price", candles[0]?.close === 200n);
  check("high spans the move", candles[0]?.high === 200n);
  check("low spans the move", candles[0]?.low === 100n);
  check("volume is the notional", candles[0]?.volume === 1_000n);
}

{
  // Same shape, downward. The high must come from the OPEN, which a naive
  // implementation taking high/low from trades alone would clip away.
  const candles = aggregate([trade(60, 50n, 1_000n)], 60, 100n);

  check("a downward move keeps its high at the open", candles[0]?.high === 100n);
  check("a downward move lows at the traded price", candles[0]?.low === 50n);
}

{
  // The market's very first trade has no prior price. Opening at anything other
  // than its own price would invent a move that never happened.
  const candles = aggregate([trade(0, 100n, 500n)], 60, null);

  check("the first candle of all opens at its own trade", candles[0]?.open === 100n);
  check("and therefore has no range", candles[0]?.high === candles[0]?.low);
}

section("Buckets and gaps");

{
  const trades = [
    trade(0, 100n, 10n),
    trade(30, 120n, 20n),
    // Nothing in bucket 60. Bucket 120 must still open at 120, not at 150.
    trade(125, 150n, 30n),
    trade(150, 140n, 40n),
  ];

  const candles = aggregate(trades, 60, 90n);

  check("empty buckets are not emitted", candles.length === 2);
  check("first bucket is 0", candles[0]?.bucket === 0);
  check("second bucket skips to 120", candles[1]?.bucket === 120);
  check("the gap does not reset the opening price", candles[1]?.open === 120n);
  check("first bucket opens at the prior price", candles[0]?.open === 90n);
  check("first bucket closes at its last trade", candles[0]?.close === 120n);
  check("volume sums within a bucket", candles[0]?.volume === 30n);
  check("trade count is per bucket", candles[0]?.tradeCount === 2 && candles[1]?.tradeCount === 2);

  // Close of one bucket must equal the open of the next, or a chart shows a
  // phantom gap between adjacent candles.
  check("candles are contiguous in price", candles[0]?.close === candles[1]?.open);
}

{
  // Sub-bucket boundary: a trade exactly on the boundary starts the new bucket.
  const candles = aggregate([trade(59, 100n, 1n), trade(60, 110n, 1n)], 60, 100n);

  check("a trade on the boundary opens the next bucket", candles.length === 2);
  check("boundary trade lands in the later bucket", candles[1]?.bucket === 60);
}

section("Aggregation is idempotent and interval-independent");

{
  const trades = [
    trade(0, 100n, 10n),
    trade(90, 130n, 20n),
    trade(200, 110n, 30n),
    trade(3_700, 160n, 40n),
  ];

  const first = aggregate(trades, 60, 100n);
  const second = aggregate(trades, 60, 100n);

  check(
    "the same input produces the same output",
    JSON.stringify(first, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) ===
      JSON.stringify(second, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );

  // Total volume must not depend on the interval. If it did, the hourly chart
  // and the daily chart would disagree about how much traded.
  const totals = CANDLE_INTERVALS.map((interval) =>
    aggregate(trades, interval, 100n).reduce((sum, c) => sum + c.volume, 0n),
  );

  check("volume is conserved across every interval", totals.every((t) => t === totals[0]));
  check("and equals the sum of the trades", totals[0] === 100n);

  const all = aggregateAll(trades, 100n);
  check(
    "aggregateAll covers every interval",
    new Set(all.map((c) => c.intervalSeconds)).size === CANDLE_INTERVALS.length,
  );

  // Closing price must agree across intervals: the last trade is the last trade.
  const closes = CANDLE_INTERVALS.map((interval) => {
    const series = aggregate(trades, interval, 100n);
    return series[series.length - 1]?.close;
  });
  check("the final close agrees across intervals", closes.every((c) => c === 160n));
}

{
  check("a zero interval is refused", (() => {
    try {
      aggregate([], 0, null);
      return false;
    } catch (error) {
      return error instanceof RangeError;
    }
  })());

  check("no trades yields no candles", aggregate([], 60, 100n).length === 0);
}

section("Bucket windows cover whole buckets");

{
  const { from, to } = bucketWindow(3_725, 3_600);
  check("window starts at the bucket boundary", from === 3_600);
  check("window ends at the next boundary", to === 7_200);
  check("a timestamp on the boundary is its own window", bucketWindow(3_600, 3_600).from === 3_600);
}

section("Job identifiers are deterministic (§431)");

{
  check(
    "the same work yields the same id",
    candleJobId(MARKET, 60, 120) === candleJobId(MARKET, 60, 120),
  );

  check(
    "case in the address does not change the id",
    candleJobId(MARKET.toLowerCase(), 60, 120) === candleJobId(MARKET.toUpperCase(), 60, 120),
  );

  check("a different bucket is a different job", candleJobId(MARKET, 60, 120) !== candleJobId(MARKET, 60, 180));
  check("a different interval is a different job", candleJobId(MARKET, 60, 120) !== candleJobId(MARKET, 300, 120));

  check("ids carry their kind", candleJobId(MARKET, 60, 120).startsWith(`${JOB_KINDS.CANDLES}:`));
  check(
    "kinds do not collide across producers",
    new Set([
      candleJobId(MARKET, 60, 120),
      holderJobId(MARKET, 120n),
      healthJobId(0n, 120n),
      analyticsJobId(MARKET, 120),
    ]).size === 4,
  );

  // Nothing in an id may come from a clock. If it did, a producer running twice
  // for the same work would enqueue it twice, the ON CONFLICT would never fire,
  // and the failure would look like ordinary duplicate work.
  //
  // Generated twice with the wall clock deliberately moved in between, so an id
  // that reached for `Date.now()` would differ.
  const build = () => [
    candleJobId(MARKET, 60, 120),
    holderJobId(MARKET, 999n),
    healthJobId(1n, 2n),
    analyticsJobId(MARKET, 20_100),
  ];

  const before = build();
  const realNow = Date.now;
  Date.now = () => realNow() + 7_200_000;
  const after = build();
  Date.now = realNow;

  check("no id moves when the clock does", before.join("|") === after.join("|"));

  // And none of them embeds a current-epoch-looking value that only happens to
  // match because both calls were quick.
  const nowSeconds = String(Math.floor(realNow() / 1000)).slice(0, 6);
  check("no id embeds the current time", before.every((id) => !id.includes(nowSeconds)));
}

section("Retry is bounded where it says it is");

{
  const config = DEFAULT_RUNNER_CONFIG;

  check("backoff grows", backoffSeconds(1, config) < backoffSeconds(3, config));
  check("first retry uses the base delay", backoffSeconds(1, config) === config.baseBackoffSeconds);
  check("second retry doubles", backoffSeconds(2, config) === config.baseBackoffSeconds * 2);
  check("backoff is capped", backoffSeconds(50, config) === config.maxBackoffSeconds);
  check("a huge attempt count does not overflow", Number.isFinite(backoffSeconds(10_000, config)));

  // The boundary. `attempts` counts attempts USED, so a job on its last allowed
  // attempt must still be retried, and only the one after it dies.
  check(
    "a job with attempts remaining retries",
    retryDecision({ attempts: 4, maxAttempts: 5 }, config, 1_000).status === "PENDING",
  );

  check(
    "a job that used its last attempt is dead lettered",
    retryDecision({ attempts: 5, maxAttempts: 5 }, config, 1_000).status === "DEAD",
  );

  check(
    "a dead letter carries no retry time",
    retryDecision({ attempts: 5, maxAttempts: 5 }, config, 1_000).retryAt === null,
  );

  check(
    "a retry is scheduled forward, never into the past",
    (retryDecision({ attempts: 1, maxAttempts: 5 }, config, 1_000).retryAt ?? 0) > 1_000,
  );

  check(
    "a single-attempt job dies on its first failure",
    retryDecision({ attempts: 1, maxAttempts: 1 }, config, 1_000).status === "DEAD",
  );
}

section("Logs are structured");

{
  const line = logLine({ level: "warn", event: "job.retry", id: "candles:0xabc:60:0" });
  const parsed = JSON.parse(line) as Record<string, unknown>;

  check("every line is valid JSON", typeof parsed === "object");
  check("every line names the service", parsed.service === "worker");
  check("the event is a field, not prose", parsed.event === "job.retry");
}

console.log(failures === 0 ? "\nworker: all checks passed" : `\nworker: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

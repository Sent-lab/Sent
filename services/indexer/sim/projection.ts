/**
 * SENT — projection replay proof.
 *
 * §138 claims this database is a rebuildable projection of the chain. That claim
 * is only worth something if replaying events actually reproduces the contract's
 * own state, exactly.
 *
 * `contracts/test/ProjectionFixture.t.sol` runs a real trading session against a
 * real market — mixed buys and sells across six traders, then graduation — reads
 * the emitted logs with `vm.getRecordedLogs`, and writes both the decoded events
 * and the market's SELF-REPORTED final state.
 *
 * This replays those events through the production reducer and asserts the two
 * agree. Because the fixture's events come from real logs rather than from values
 * the test already knew, a missing or wrong event field fails here rather than
 * quietly agreeing with itself.
 *
 * The fixture uses a 6-decimal quote asset on purpose: at 18 decimals raw and
 * normalized coincide and a unit error is invisible.
 *
 * Run: pnpm sim:projection
 */

import { readFileSync } from "node:fs";

import {
  project,
  holderCount,
  totalHeld,
  type MarketEvent,
} from "../src/projection.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface RawEvent {
  type: string;
  blockNumber: number | string;
  logIndex: number | string;
  account: string;
  a: number | string;
  b: number | string;
  c: number | string;
  coreFee: number | string;
  stockback: number | string;
  newDistributed: number | string;
  newCollateral: number | string;
}

interface Fixture {
  events: RawEvent[];
  finalState: {
    status: number | string;
    distributed: number | string;
    curveCollateral: number | string;
    pool: string;
    positionId: number | string;
  };
}

/** Foundry emits small integers as JSON numbers and large ones as strings. */
const big = (v: number | string): bigint => BigInt(typeof v === "string" ? v : Math.trunc(v));

const fixture = JSON.parse(
  readFileSync("contracts/test/fixtures/projection.json", "utf8"),
) as Fixture;

console.log("\nSENT — Projection Replay Proof (§138 rebuildable projection)");
console.log("=".repeat(74));
console.log(`  events captured   ${fixture.events.length}`);

const events: MarketEvent[] = fixture.events.map((e) => {
  const blockNumber = big(e.blockNumber);
  const logIndex = Number(e.logIndex);

  if (e.type === "Bought") {
    return {
      type: "Bought",
      blockNumber,
      logIndex,
      buyer: e.account,
      grossQuoteIn: big(e.a),
      netToCurve: big(e.b),
      tokensOut: big(e.c),
      coreFee: big(e.coreFee),
      stockback: big(e.stockback),
      newDistributed: big(e.newDistributed),
      newCollateral: big(e.newCollateral),
    };
  }

  if (e.type === "Sold") {
    return {
      type: "Sold",
      blockNumber,
      logIndex,
      seller: e.account,
      tokensIn: big(e.a),
      grossQuoteOut: big(e.b),
      netQuoteOut: big(e.c),
      coreFee: big(e.coreFee),
      stockback: big(e.stockback),
      newDistributed: big(e.newDistributed),
      newCollateral: big(e.newCollateral),
    };
  }

  return {
    type: "Graduated",
    blockNumber,
    logIndex,
    token: e.account,
    pool: e.account,
    positionId: big(e.a),
    tokenAmount: big(e.b),
    quoteAmount: big(e.c),
  };
});

const state = project(events);

const expectedStatus = Number(fixture.finalState.status);
const expectedDistributed = big(fixture.finalState.distributed);
const expectedCollateral = big(fixture.finalState.curveCollateral);

console.log(`  buys / sells      ${state.buyCount} / ${state.sellCount}`);
console.log(`  holders           ${holderCount(state)}`);
console.log(`  status on-chain   ${expectedStatus} (0=PRE_GRAD, 1=GRADUATING, 2=GRADUATED)`);

// ---------------------------------------------------------------------------
console.log("\n--- The projection must equal the contract ---------------------------");

check("events were actually captured", events.length > 0);
check("both sides of the book were exercised", state.buyCount > 0 && state.sellCount > 0);

check(
  "distributed matches the contract exactly",
  state.distributed === expectedDistributed,
  `projection ${state.distributed} vs chain ${expectedDistributed}`,
);

check(
  "curve collateral matches the contract exactly",
  state.curveCollateral === expectedCollateral,
  `projection ${state.curveCollateral} vs chain ${expectedCollateral}`,
);

const expectedStatusName =
  expectedStatus === 0 ? "PRE_GRAD" : expectedStatus === 1 ? "GRADUATING" : "GRADUATED";

check(
  "lifecycle status matches the contract",
  state.status === expectedStatusName,
  `projection ${state.status} vs chain ${expectedStatusName}`,
);

// §19: GRADUATING exists only inside a transaction. A projection that lands on it
// means the indexer captured a partial state, which must be impossible.
check("the projection never rests in GRADUATING", state.status !== "GRADUATING");

// ---------------------------------------------------------------------------
console.log("\n--- Balance accounting -----------------------------------------------");

// Every token the curve released is held by somebody. Missing a Transfer is how
// Stockback quietly starts paying the wrong people.
check(
  "tokens held equals tokens distributed",
  totalHeld(state) === state.distributed,
  `held ${totalHeld(state)} vs distributed ${state.distributed}`,
);

check("no account carries a negative balance", [...state.balances.values()].every((b) => b >= 0n));
check("holders were actually recorded", holderCount(state) > 0);

// ---------------------------------------------------------------------------
console.log("\n--- Replay is deterministic ------------------------------------------");

// A full reindex may receive logs in any order the query returns. If the result
// depended on that order, "rebuildable" would be false.
const shuffled = [...events].reverse();
const fromShuffled = project(shuffled);

check(
  "event order does not change the result",
  fromShuffled.distributed === state.distributed &&
    fromShuffled.curveCollateral === state.curveCollateral &&
    fromShuffled.status === state.status,
);

check(
  "balances are identical after a shuffled replay",
  [...state.balances.entries()].every(([k, v]) => fromShuffled.balances.get(k) === v) &&
    fromShuffled.balances.size === state.balances.size,
);

// Replaying twice must not double-count: a reindex is a supported operation.
const twice = project([...events]);
check(
  "a second full replay produces identical state",
  twice.distributed === state.distributed &&
    twice.cumulativeCoreFees === state.cumulativeCoreFees &&
    twice.tradeCount === state.tradeCount,
);

// ---------------------------------------------------------------------------
console.log("\n--- Fee totals come from events, never recomputed ----------------------");

let summedCore = 0n;
let summedStockback = 0n;
for (const e of events) {
  if (e.type === "Bought" || e.type === "Sold") {
    summedCore += e.coreFee;
    summedStockback += e.stockback;
  }
}

check("cumulative core fees equal the sum of event values", state.cumulativeCoreFees === summedCore);
check(
  "cumulative Stockback equals the sum of event values",
  state.cumulativeStockback === summedStockback,
);
check("fees were actually collected", summedCore > 0n && summedStockback > 0n);

// ---------------------------------------------------------------------------
console.log("\n--- Out-of-order events are rejected, not absorbed ---------------------");

{
  let rejected = false;
  try {
    const backwards: MarketEvent[] = [events[events.length - 1]!, events[0]!];
    // `project` sorts, so drive the reducer directly to prove the guard exists.
    const { emptyProjection, applyEvent } = await import("../src/projection.ts");
    const s = emptyProjection();
    applyEvent(s, backwards[0]!);
    applyEvent(s, backwards[1]!);
  } catch {
    rejected = true;
  }
  check("an event from an earlier block is rejected by the reducer", rejected);
}

// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(74));
if (failures.length === 0) {
  console.log(`PROJECTION PROOF: PASS — ${passed} checks green.`);
  console.log("");
  console.log("The off-chain projection reproduces the contract's own state exactly,");
  console.log("from real logs, at 6 decimals, through buys, sells and graduation.");
  console.log("§138's 'rebuildable projection' is a tested property, not a claim.");
} else {
  console.log(`PROJECTION PROOF: FAIL — ${failures.length} of ${passed + failures.length} failed.`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
console.log("");

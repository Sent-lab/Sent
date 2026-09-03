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

  if (e.type === "GraduationPending") {
    return {
      type: "GraduationPending",
      blockNumber,
      logIndex,
      token: e.account,
      tokenAmount: big(e.a),
      quoteAmount: big(e.b),
      pg: big(e.c),
    };
  }

  // Explicit branches above rather than a fall-through for everything that is
  // not Bought or Sold. The fall-through decoded GraduationPending as Graduated
  // - same arity, same field names, silently wrong state - which is the failure
  // mode a fixture replay is supposed to catch rather than commit.
  if (e.type !== "Graduated") {
    throw new Error(`unknown fixture event type: ${e.type}`);
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

/*
 * GRADUATING used to be unreachable here, and this checked that it never
 * appeared. That check now passes for the wrong reason — the fixture ends
 * GRADUATED, so "never GRADUATING at the end" is true no matter what the
 * reducer does with the state in between, including ignoring it entirely.
 *
 * The real property, since D-016, is the opposite one: the market PASSES
 * THROUGH a resting GRADUATING state in its own block, and the reducer must
 * land on it and hold it there until the migration arrives. A reducer that
 * skipped `GraduationPending` would still reach GRADUATED and still satisfy
 * every other check on this page, while reporting a closed curve as open for
 * however long finalisation takes.
 *
 * So it is replayed one event at a time and the intermediate state is asserted.
 */
const pendingIndex = events.findIndex((e) => e.type === "GraduationPending");
check("the fixture actually covers the two-step graduation", pendingIndex >= 0);

if (pendingIndex >= 0) {
  const upToPending = project(events.slice(0, pendingIndex + 1));

  check(
    "the reducer rests in GRADUATING once the curve closes",
    upToPending.status === "GRADUATING",
    `got ${upToPending.status}`,
  );

  check(
    "and records the block it closed in, so a keeper can find it",
    upToPending.graduatingAtBlock !== null,
  );

  /*
   * Collateral is NOT zeroed yet. Nothing has reached the router at this point,
   * so a projection that zeroed it here would report a market as having migrated
   * value it is still holding — and `marketCanCoverItsCollateral`, the solvency
   * view an operator would check during exactly this window, would read clean
   * against a market whose books say it owes nothing.
   */
  check(
    "and still shows the collateral the market is still holding",
    upToPending.curveCollateral > 0n,
    `collateral ${upToPending.curveCollateral} should be non-zero before the migration`,
  );

  check(
    "and no pool, because there is not one yet",
    upToPending.pool === null && upToPending.positionId === null,
  );
}

check(
  "the completed projection records when the curve closed",
  state.graduatingAtBlock !== null,
);

// A reindex that starts after the crossing buy never sees `GraduationPending`.
// It must still end up in the same place, or the projection is not rebuildable
// from an arbitrary height — which is the whole of §138's claim.
if (pendingIndex >= 0) {
  const fromLate = project(events.slice(pendingIndex + 1));
  check(
    "a reindex that missed the crossing buy still lands on GRADUATED",
    fromLate.status === state.status,
    `got ${fromLate.status}`,
  );
  check(
    "and still records a closing block rather than a null",
    fromLate.graduatingAtBlock !== null,
  );
}

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

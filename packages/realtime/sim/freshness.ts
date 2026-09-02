/**
 * SENT — freshness contract audit.
 *
 * §87 requires the UI to distinguish sources of truth and forbids implying that
 * two metrics with different freshness updated together. §211 enumerates the
 * states. §451 lists a misleading financial UI state as a release blocker.
 *
 * Those are rules about rendering, which usually means they are enforced by
 * review and therefore not enforced at all. These checks pull them into code.
 *
 * Run: pnpm sim:freshness
 */

import {
  classifyFreshness,
  shareTimestamp,
  mustBeVisuallyDistinct,
  channelKey,
  DEFAULT_THRESHOLDS,
  type Sourced,
} from "../src/schema.ts";

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

console.log("\nSENT — Freshness Contract Audit (§87, §211, §293, §403)");
console.log("=".repeat(74));

// ---------------------------------------------------------------------------
console.log("\n--- 1. State classification ------------------------------------------");

check("fully caught up reads LIVE", classifyFreshness(0, true) === "LIVE");
check("a block or two behind is still LIVE", classifyFreshness(2, true) === "LIVE");
check("a small lag reads SYNCING", classifyFreshness(5, true) === "SYNCING");
check("a larger lag reads DELAYED", classifyFreshness(30, true) === "DELAYED");
check("a severe lag reads STALE", classifyFreshness(500, true) === "STALE");

// A disconnected client must never be told the data is live, however fresh the
// last snapshot was: it has no way to learn about the next trade.
check("a disconnected client reads RECONNECTING regardless of lag", classifyFreshness(0, false) === "RECONNECTING");

// The classifier must be monotonic — worse lag can never report a better state.
{
  const order = ["LIVE", "SYNCING", "DELAYED", "STALE"];
  let monotonic = true;
  let previous = 0;

  for (let lag = 0; lag <= 200; lag++) {
    const rank = order.indexOf(classifyFreshness(lag, true));
    if (rank < previous) monotonic = false;
    previous = rank;
  }

  check("freshness never improves as lag grows", monotonic);
}

check(
  "thresholds are ordered so no state is unreachable",
  DEFAULT_THRESHOLDS.syncingAbove < DEFAULT_THRESHOLDS.delayedAbove &&
    DEFAULT_THRESHOLDS.delayedAbove < DEFAULT_THRESHOLDS.staleAbove,
);

// ---------------------------------------------------------------------------
console.log("\n--- 2. §87: mixed freshness must not share a timestamp ------------------");

const onChain: Sourced = { value: "100", provenance: "ON_CHAIN", asOfBlock: "500", asOf: 1000 };
const indexedSameBlock: Sourced = { value: "100", provenance: "INDEXED", asOfBlock: "500", asOf: 1000 };
const indexedOlder: Sourced = { value: "99", provenance: "INDEXED", asOfBlock: "480", asOf: 900 };
const indexedSame: Sourced = { value: "97", provenance: "INDEXED", asOfBlock: "500", asOf: 1000 };

check(
  "two values from the same source, block and instant may share a timestamp",
  shareTimestamp(indexedSameBlock, indexedSame),
);

check(
  "a chain read and an indexed value may NOT share a timestamp",
  !shareTimestamp(onChain, indexedSameBlock),
);

check(
  "values from different blocks may NOT share a timestamp",
  !shareTimestamp(indexedSameBlock, indexedOlder),
);

// This is the rule a dashboard breaks by putting one "updated 2s ago" label above
// a panel whose tiles came from four different places.
check(
  "the check is symmetric",
  shareTimestamp(onChain, indexedSameBlock) === shareTimestamp(indexedSameBlock, onChain),
);

// ---------------------------------------------------------------------------
console.log("\n--- 3. §293: estimated accrual is not a claimable entitlement -----------");

check(
  "estimated Stockback must be visually distinct from on-chain state",
  mustBeVisuallyDistinct("ESTIMATED", "ON_CHAIN"),
);
check(
  "estimated must also be distinct from indexed",
  mustBeVisuallyDistinct("ESTIMATED", "INDEXED"),
);

// §402/§403: the launch anchor fixes P0 for the market's whole life and is not a
// live price. Showing them alike invites a user to read the anchor as current.
check(
  "a reference valuation must be distinct from a chain read",
  mustBeVisuallyDistinct("REFERENCE", "ON_CHAIN"),
);
check(
  "a reference valuation must be distinct from a delayed feed",
  mustBeVisuallyDistinct("REFERENCE", "DELAYED"),
);

check(
  "two indexed values need no distinction",
  !mustBeVisuallyDistinct("INDEXED", "INDEXED"),
);
check(
  "the distinction rule is symmetric",
  mustBeVisuallyDistinct("ON_CHAIN", "ESTIMATED") === mustBeVisuallyDistinct("ESTIMATED", "ON_CHAIN"),
);

// ---------------------------------------------------------------------------
console.log("\n--- 4. Channels ---------------------------------------------------------");

check(
  "market channels are case-insensitive",
  channelKey({ kind: "market", market: "0xAbCd" }) === channelKey({ kind: "market", market: "0xabcd" }),
);
check(
  "account channels are case-insensitive",
  channelKey({ kind: "account", account: "0xAbCd" }) === channelKey({ kind: "account", account: "0xabcd" }),
);

// A market and an account at the same address string must not collide, or a
// holder would receive another market's tape.
check(
  "market and account namespaces cannot collide",
  channelKey({ kind: "market", market: "0xabcd" }) !== channelKey({ kind: "account", account: "0xabcd" }),
);

// ---------------------------------------------------------------------------
console.log("\n--- 5. Pessimism under uncertainty --------------------------------------");

// Showing DELAYED during a healthy blip costs a user nothing. Showing LIVE while
// serving minute-old prices is what §451 blocks a release for.
{
  let everOptimistic = false;
  for (let lag = 0; lag <= 300; lag++) {
    if (!connectedStateIsHonest(lag)) everOptimistic = true;
  }
  check("a disconnected client is never shown a better state than a lagging one", !everOptimistic);
}

function connectedStateIsHonest(lag: number): boolean {
  const rank = ["LIVE", "SYNCING", "DELAYED", "RECONNECTING", "STALE"];
  const disconnected = rank.indexOf(classifyFreshness(lag, false));
  const connected = rank.indexOf(classifyFreshness(lag, true));
  // RECONNECTING must always outrank LIVE/SYNCING/DELAYED.
  return disconnected >= connected || classifyFreshness(lag, true) === "STALE";
}

// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(74));
if (failures.length === 0) {
  console.log(`FRESHNESS AUDIT: PASS — ${passed} checks green.`);
  console.log("");
  console.log("Provenance travels with the value, so a component cannot render a");
  console.log("projection and an entitlement as the same kind of number by accident.");
} else {
  console.log(`FRESHNESS AUDIT: FAIL — ${failures.length} of ${passed + failures.length} failed.`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
console.log("");

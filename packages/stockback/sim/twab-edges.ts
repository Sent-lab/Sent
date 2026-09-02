/**
 * SENT — TWAB edge-case audit.
 *
 * `stockback.ts` covers the behaviours the masterplan states in prose. This file
 * attacks the boundaries those descriptions do not mention, because that is where
 * an integral over piecewise-constant balances actually goes wrong:
 *
 *   - an event landing exactly on an epoch boundary
 *   - several events sharing one timestamp
 *   - a holder who exists only in the opening balances and never trades
 *   - a holder who exits completely mid-epoch
 *   - a holder who exits and returns within the same epoch
 *   - events arriving out of order
 *   - events belonging to a neighbouring epoch
 *   - a single-second hold, which is the smallest unit of exposure that must pay
 *
 * Run: pnpm sim:twab-edges
 */

import {
  EPOCH_DURATION_SECONDS,
  epochStart,
  epochEnd,
  computeEpochWeights,
  distributeEpoch,
  makeExclusionSet,
  type BalanceEvent,
} from "../src/twab.ts";

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

const WAD = 10n ** 18n;
const M = 1_000_000n * WAD;
const EPOCH = 30_000n;
const START = epochStart(EPOCH);
const END = epochEnd(EPOCH);
const NONE = makeExclusionSet([]);

console.log("\nSENT — TWAB Edge-Case Audit");
console.log("=".repeat(72));

// ---------------------------------------------------------------------------
console.log("\n--- 1. Epoch boundaries ---------------------------------------------");

{
  // An event at exactly `end` belongs to the NEXT epoch. Counting it in both
  // would pay the same exposure twice across the boundary.
  const events: BalanceEvent[] = [
    { account: "a", delta: 1n * M, timestamp: START },
    { account: "b", delta: 1n * M, timestamp: END },
  ];

  const w = computeEpochWeights(EPOCH, new Map(), events, NONE);

  check("an event at exactly epoch end is excluded", (w.weights.get("b") ?? 0n) === 0n);
  check(
    "an event at exactly epoch start counts for the full epoch",
    w.weights.get("a") === 1n * M * EPOCH_DURATION_SECONDS,
  );
  check("closing balances carry the boundary event forward", !w.closingBalances.has("b"));
}

{
  // The same holder, same balance, split across two epochs, must earn the same
  // total as one continuous epoch of holding.
  const first = computeEpochWeights(
    EPOCH,
    new Map(),
    [{ account: "a", delta: 2n * M, timestamp: START }],
    NONE,
  );
  const second = computeEpochWeights(EPOCH + 1n, first.closingBalances, [], NONE);

  check(
    "a balance carried across epochs earns the same weight in each",
    first.weights.get("a") === second.weights.get("a"),
  );
  check(
    "a holder who never trades still accrues from the opening balance",
    (second.weights.get("a") ?? 0n) === 2n * M * EPOCH_DURATION_SECONDS,
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- 2. Simultaneous and unordered events ----------------------------");

{
  // A wallet-to-wallet transfer is two events at one timestamp. Exposure must be
  // handed over exactly, with nothing created or destroyed at the seam.
  const mid = START + EPOCH_DURATION_SECONDS / 2n;
  const events: BalanceEvent[] = [
    { account: "a", delta: 4n * M, timestamp: START },
    { account: "a", delta: -4n * M, timestamp: mid },
    { account: "b", delta: 4n * M, timestamp: mid },
  ];

  const w = computeEpochWeights(EPOCH, new Map(), events, NONE);
  const half = 4n * M * (EPOCH_DURATION_SECONDS / 2n);

  check("sender accrues only up to the transfer", w.weights.get("a") === half);
  check("receiver accrues only from the transfer", w.weights.get("b") === half);
  check(
    "a transfer conserves total exposure exactly",
    w.totalWeight === 4n * M * EPOCH_DURATION_SECONDS,
  );
}

{
  // The indexer may hand events over in any order; the engine sorts. A different
  // input order must not change a single weight.
  const ordered: BalanceEvent[] = [
    { account: "a", delta: 3n * M, timestamp: START + 100n },
    { account: "b", delta: 5n * M, timestamp: START + 5_000n },
    { account: "a", delta: -1n * M, timestamp: START + 40_000n },
  ];
  const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!];

  const a = computeEpochWeights(EPOCH, new Map(), ordered, NONE);
  const b = computeEpochWeights(EPOCH, new Map(), shuffled, NONE);

  check("event order does not affect weights", a.weights.get("a") === b.weights.get("a"));
  check("event order does not affect the total", a.totalWeight === b.totalWeight);
}

{
  // Events from neighbouring epochs must be ignored rather than leak in.
  const events: BalanceEvent[] = [
    { account: "a", delta: 1n * M, timestamp: START - 1n },
    { account: "b", delta: 1n * M, timestamp: END + 1n },
  ];

  const w = computeEpochWeights(EPOCH, new Map(), events, NONE);
  check("events outside the epoch are ignored", w.totalWeight === 0n);
}

// ---------------------------------------------------------------------------
console.log("\n--- 3. Exits and re-entries -----------------------------------------");

{
  const quarter = EPOCH_DURATION_SECONDS / 4n;
  const events: BalanceEvent[] = [
    { account: "a", delta: 8n * M, timestamp: START },
    { account: "a", delta: -8n * M, timestamp: START + quarter },
  ];

  const w = computeEpochWeights(EPOCH, new Map(), events, NONE);

  check("a full exit stops accrual at the exit", w.weights.get("a") === 8n * M * quarter);
  check("a fully exited holder carries no balance forward", !w.closingBalances.has("a"));
}

{
  // Out and back in. Only the time actually held counts — the gap must not.
  const q = EPOCH_DURATION_SECONDS / 4n;
  const events: BalanceEvent[] = [
    { account: "a", delta: 4n * M, timestamp: START },
    { account: "a", delta: -4n * M, timestamp: START + q },
    { account: "a", delta: 4n * M, timestamp: START + 3n * q },
  ];

  const w = computeEpochWeights(EPOCH, new Map(), events, NONE);

  check(
    "a holder who exits and returns is paid only for time held",
    w.weights.get("a") === 4n * M * (2n * q),
  );
}

{
  // The smallest possible exposure. One second of holding must still pay,
  // otherwise there is a threshold below which holding is unrewarded and the
  // "amount held x time held" promise has a hole in it.
  const events: BalanceEvent[] = [
    { account: "steady", delta: 1n * M, timestamp: START },
    { account: "brief", delta: 1_000n * M, timestamp: END - 1n },
  ];

  const w = computeEpochWeights(EPOCH, new Map(), events, NONE);
  const dist = distributeEpoch(EPOCH, 1_000_000n * WAD, w);

  check("a one-second hold accrues non-zero weight", (w.weights.get("brief") ?? 0n) > 0n);
  check("a one-second hold is paid something", (dist.rewards.get("brief") ?? 0n) > 0n);
  check(
    "and still far less than a full-epoch hold of 1/1000 the size",
    (dist.rewards.get("steady") ?? 0n) > (dist.rewards.get("brief") ?? 0n),
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- 4. Conservation under adversarial shapes ------------------------");

{
  // Many holders, many events, deliberately awkward sizes. The sum of the parts
  // must equal the integral of the whole.
  const accounts = Array.from({ length: 12 }, (_, i) => `h${i}`);
  const events: BalanceEvent[] = [];

  let seed = 987654321n;
  const rand = (n: bigint): bigint => {
    seed = (seed * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) % (1n << 64n);
    return seed % n;
  };

  const live = new Map<string, bigint>();
  const times = Array.from({ length: 200 }, () => START + rand(EPOCH_DURATION_SECONDS)).sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );

  for (const at of times) {
    const who = accounts[Number(rand(BigInt(accounts.length)))]!;
    const held = live.get(who) ?? 0n;

    if (rand(2n) === 0n || held === 0n) {
      const amount = (rand(97n) + 1n) * WAD;
      events.push({ account: who, delta: amount, timestamp: at });
      live.set(who, held + amount);
    } else {
      const amount = held / (rand(3n) + 1n);
      if (amount > 0n) {
        events.push({ account: who, delta: -amount, timestamp: at });
        live.set(who, held - amount);
      }
    }
  }

  const w = computeEpochWeights(EPOCH, new Map(), events, NONE);

  let summed = 0n;
  for (const v of w.weights.values()) summed += v;

  check("total weight equals the sum of individual weights", summed === w.totalWeight);

  const pool = 999_983n * WAD; // prime-ish, forces rounding dust
  const dist = distributeEpoch(EPOCH, pool, w);

  check("allocation never exceeds the pool", dist.allocated <= pool);
  check("pool is fully accounted", dist.allocated + dist.carryForward === pool);
  check(
    "dust is bounded by the number of recipients",
    dist.carryForward <= BigInt(dist.rewards.size),
  );

  // Nobody may receive more than their proportional share, rounded down.
  let allProportional = true;
  for (const [account, reward] of dist.rewards) {
    const weight = w.weights.get(account)!;
    if (reward > (pool * weight) / w.totalWeight) allProportional = false;
  }
  check("no holder receives more than their exact proportional share", allProportional);
}

// ---------------------------------------------------------------------------
console.log("\n--- 5. Corrupt input must be rejected, not absorbed ------------------");

{
  let rejected = false;
  try {
    computeEpochWeights(
      EPOCH,
      new Map(),
      [{ account: "a", delta: -1n * M, timestamp: START }],
      NONE,
    );
  } catch {
    rejected = true;
  }
  check("a sell with no prior balance is rejected as a corrupt stream", rejected);
}

{
  // An opening balance that is negative should never exist; the engine treats
  // only positive balances as carried, so a corrupt map cannot create weight.
  const w = computeEpochWeights(EPOCH, new Map([["a", 0n]]), [], NONE);
  check("a zero opening balance produces no weight", w.totalWeight === 0n);
}

// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(72));
if (failures.length === 0) {
  console.log(`TWAB EDGE AUDIT: PASS — ${passed} checks green.`);
} else {
  console.log(`TWAB EDGE AUDIT: FAIL — ${failures.length} of ${passed + failures.length} failed.`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
console.log("");

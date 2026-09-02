/**
 * SENT — finalizer simulation.
 *
 * The finalizer's one job is to hand attestors a commitment that is safe to
 * sign. Two properties make it safe, and both are tested here:
 *
 *   1. Successive commitments are NON-DECREASING per holder. The vault pays
 *      `cumulative − claimed`, so a cumulative that ever falls turns a claim into
 *      an underpayment — and for a holder who already claimed the full amount, a
 *      permanent one.
 *
 *   2. Nothing is committed over an epoch the chain has not settled.
 *
 * Property 1 is the reason `computeFinalization` is fed the whole history every
 * run. This file contains the counter-example that makes that non-negotiable:
 * the same events computed incrementally produce a SMALLER cumulative, which
 * would have looked like a working optimisation and quietly underpaid everyone.
 */

import { EPOCH_DURATION_SECONDS, type BalanceEvent } from "@sent/stockback";
import { computeDistribution, bucketByEpoch } from "@sent/stockback-service";

import {
  Finalizer,
  computeFinalization,
  DEFAULT_FINALIZER_CONFIG,
  type MarketToFinalize,
} from "../src/finalizer.ts";

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

const TARGET: MarketToFinalize = {
  market: "0x1111111111111111111111111111111111111111",
  token: "0x2222222222222222222222222222222222222222",
  rewardAsset: "0x3333333333333333333333333333333333333333",
};

const ALICE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CAROL = "0xcccccccccccccccccccccccccccccccccccccccc";

const WAD = 10n ** 18n;

/** Timestamp `hours` into `epoch`. */
function at(epoch: bigint, hours: number): bigint {
  return epoch * EPOCH_DURATION_SECONDS + BigInt(hours) * 3600n;
}

/**
 * A market where holders enter at different times and one exits.
 *
 * Deliberately not uniform: if everyone held the same balance for the whole
 * window, an incremental computation would coincidentally agree with a full one
 * and the counter-example below would prove nothing.
 */
function scenario(): { events: BalanceEvent[]; funding: Map<bigint, bigint> } {
  const events: BalanceEvent[] = [
    { account: ALICE, delta: 1_000n * WAD, timestamp: at(0n, 0) },
    { account: BOB, delta: 400n * WAD, timestamp: at(0n, 12) },
    { account: CAROL, delta: 250n * WAD, timestamp: at(1n, 6) },
    { account: BOB, delta: -400n * WAD, timestamp: at(2n, 3) },
    { account: ALICE, delta: 500n * WAD, timestamp: at(3n, 9) },
  ];

  const funding = new Map<bigint, bigint>([
    [0n, 1_000_000n],
    [1n, 2_500_000n],
    [2n, 1_750_000n],
    [3n, 3_000_000n],
    [4n, 900_000n],
  ]);

  return { events, funding };
}

const TOTAL_FUNDED = 9_150_000n;

// ---------------------------------------------------------------------------

section("Cumulative entitlements never decrease across commitments");

{
  const { events, funding } = scenario();

  // Simulate the service running on four successive days, each time seeing one
  // more settled epoch — which is exactly how it behaves in production.
  const commitments = [];

  for (let through = 1n; through <= 4n; through++) {
    const outcome = computeFinalization({
      target: TARGET,
      through,
      events: events.filter((e) => e.timestamp < (through + 1n) * EPOCH_DURATION_SECONDS),
      funding,
      totalFunded: TOTAL_FUNDED,
      excludedAccounts: [],
      lastCommittedEpoch: through === 1n ? null : through - 1n,
    });

    check(`epoch ${through} produced a commitment`, typeof outcome !== "string");
    if (typeof outcome === "string") break;
    commitments.push(outcome.result);
  }

  check("four successive commitments", commitments.length === 4);

  let monotone = true;
  let sequenceRises = true;

  for (let i = 1; i < commitments.length; i++) {
    const previous = new Map(
      commitments[i - 1]!.tree.entries.map((e) => [e.account.toLowerCase(), e.cumulative]),
    );

    for (const entry of commitments[i]!.tree.entries) {
      const before = previous.get(entry.account.toLowerCase()) ?? 0n;
      if (entry.cumulative < before) monotone = false;
    }

    // A holder present earlier must not VANISH either — the vault would keep
    // honouring the old root, but the claim page would show them nothing.
    for (const account of previous.keys()) {
      const still = commitments[i]!.tree.entries.some(
        (e) => e.account.toLowerCase() === account,
      );
      if (!still) monotone = false;
    }

    if (
      commitments[i]!.commitment.epochSequence <=
      commitments[i - 1]!.commitment.epochSequence
    ) {
      sequenceRises = false;
    }
  }

  check("no holder's cumulative ever decreases", monotone);
  check("epoch sequence strictly increases (§365 monotonicity)", sequenceRises);

  const last = commitments[commitments.length - 1]!;
  check(
    "total committed stays within funding (§364)",
    last.commitment.totalCumulative <= TOTAL_FUNDED,
  );
}

section("Incremental computation is the trap this design avoids");

{
  const { events, funding } = scenario();
  const incrementalFunding = new Map([...funding].filter(([epoch]) => epoch >= 2n));
  const laterEvents = events.filter((e) => e.timestamp >= 2n * EPOCH_DURATION_SECONDS);

  // Failure mode one, the loud one: a truncated stream loses the entry that
  // preceded an exit, so the exit drives the balance negative. The TWAB engine
  // refuses it rather than clamping — a clamp here would silently change who
  // held what.
  let rejected = false;
  try {
    computeDistribution({
      market: TARGET.market,
      token: TARGET.token,
      rewardAsset: TARGET.rewardAsset,
      distributionVersion: 1n,
      excludedAccounts: [],
      epochs: bucketByEpoch(laterEvents, incrementalFunding).filter((e) => e.epochId <= 4n),
      totalFunded: TOTAL_FUNDED,
    });
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("negative balance");
  }

  check("a truncated event stream is rejected outright", rejected);
}

{
  // Failure mode two, the dangerous one: with no exits there is nothing to drive
  // a balance negative, so the increment computes cleanly — and underpays. This
  // is what an "optimisation" would look like in review: correct-looking output,
  // passing tests, every holder short.
  const events: BalanceEvent[] = [
    { account: ALICE, delta: 1_000n * WAD, timestamp: at(0n, 0) },
    { account: BOB, delta: 400n * WAD, timestamp: at(0n, 12) },
    { account: CAROL, delta: 250n * WAD, timestamp: at(1n, 6) },
    { account: ALICE, delta: 500n * WAD, timestamp: at(3n, 9) },
  ];
  const { funding } = scenario();

  const base = {
    market: TARGET.market,
    token: TARGET.token,
    rewardAsset: TARGET.rewardAsset,
    distributionVersion: 1n,
    excludedAccounts: [] as readonly string[],
    totalFunded: TOTAL_FUNDED,
  };

  const full = computeDistribution({
    ...base,
    epochs: bucketByEpoch(events, funding).filter((e) => e.epochId <= 4n),
  });

  const incremental = computeDistribution({
    ...base,
    epochs: bucketByEpoch(
      events.filter((e) => e.timestamp >= 2n * EPOCH_DURATION_SECONDS),
      new Map([...funding].filter(([epoch]) => epoch >= 2n)),
    ).filter((e) => e.epochId <= 4n),
  });

  check(
    "the increment computes without complaint",
    incremental.commitment.totalCumulative > 0n,
  );

  check(
    "and commits strictly less than the full history",
    incremental.commitment.totalCumulative < full.commitment.totalCumulative,
  );

  const fullAlice =
    full.tree.entries.find((e) => e.account.toLowerCase() === ALICE)?.cumulative ?? 0n;
  const incrementalAlice =
    incremental.tree.entries.find((e) => e.account.toLowerCase() === ALICE)?.cumulative ?? 0n;

  check("a holder would be underpaid", incrementalAlice < fullAlice);

  // The exact shape of the loss, so a regression reads as a number rather than
  // as a vague inequality.
  console.log(
    `       alice: full ${fullAlice} vs incremental ${incrementalAlice} ` +
      `(would lose ${fullAlice - incrementalAlice})`,
  );

  check(
    "roots differ, so the two are not interchangeable",
    full.tree.root !== incremental.tree.root,
  );
}

section("Settlement boundary");

{
  const finalizer = new Finalizer(null as never, DEFAULT_FINALIZER_CONFIG);
  const margin = DEFAULT_FINALIZER_CONFIG.settlementMarginSeconds;
  const day = Number(EPOCH_DURATION_SECONDS);

  check(
    "an epoch containing the cut-off is not finalizable",
    finalizer.finalizableThrough(3 * day + margin + 60) === 2n,
  );

  check(
    "the epoch that just closed is finalizable once the margin passes",
    finalizer.finalizableThrough(3 * day + margin) === 2n,
  );

  check(
    "the margin holds back an epoch that closed moments ago",
    finalizer.finalizableThrough(3 * day + 1) === 1n,
  );

  check("nothing settled yields nothing finalizable", finalizer.finalizableThrough(0) === -1n);

  check(
    "a settled timestamp inside the margin yields nothing",
    finalizer.finalizableThrough(margin - 1) === -1n,
  );
}

section("Skip reasons are states, not failures");

{
  const { funding } = scenario();

  check(
    "no events yields NO_BALANCE_EVENTS",
    computeFinalization({
      target: TARGET,
      through: 4n,
      events: [],
      funding,
      totalFunded: TOTAL_FUNDED,
      excludedAccounts: [],
      lastCommittedEpoch: null,
    }) === "NO_BALANCE_EVENTS",
  );

  check(
    "an already-committed epoch yields NO_NEW_EPOCHS",
    computeFinalization({
      target: TARGET,
      through: 2n,
      events: scenario().events,
      funding,
      totalFunded: TOTAL_FUNDED,
      excludedAccounts: [],
      lastCommittedEpoch: 2n,
    }) === "NO_NEW_EPOCHS",
  );

  check(
    "nothing settled yields NO_CLOSED_EPOCH",
    computeFinalization({
      target: TARGET,
      through: -1n,
      events: scenario().events,
      funding,
      totalFunded: TOTAL_FUNDED,
      excludedAccounts: [],
      lastCommittedEpoch: null,
    }) === "NO_CLOSED_EPOCH",
  );

  // Excluding every holder must not commit an empty tree — it must decline, so
  // the pool carries forward (§328) instead of being silently written off.
  check(
    "excluding every holder yields NOT_DISTRIBUTABLE",
    computeFinalization({
      target: TARGET,
      through: 4n,
      events: scenario().events,
      funding,
      totalFunded: TOTAL_FUNDED,
      excludedAccounts: [ALICE, BOB, CAROL],
      lastCommittedEpoch: null,
    }) === "NOT_DISTRIBUTABLE",
  );

  // §364: a commitment above the ceiling is an outage. It must be refused here,
  // where it is a log line, not at the vault, where it is a failed distribution.
  check(
    "committing more than was funded is refused",
    computeFinalization({
      target: TARGET,
      through: 4n,
      events: scenario().events,
      funding,
      totalFunded: 1n,
      excludedAccounts: [],
      lastCommittedEpoch: null,
    }) === "NOT_DISTRIBUTABLE",
  );
}

section("Exclusions are applied, not merely accepted");

{
  const { events, funding } = scenario();

  const withAll = computeFinalization({
    target: TARGET,
    through: 4n,
    events,
    funding,
    totalFunded: TOTAL_FUNDED,
    excludedAccounts: [],
    lastCommittedEpoch: null,
  });

  const withoutBob = computeFinalization({
    target: TARGET,
    through: 4n,
    events,
    funding,
    totalFunded: TOTAL_FUNDED,
    excludedAccounts: [BOB],
    lastCommittedEpoch: null,
  });

  check("both computed", typeof withAll !== "string" && typeof withoutBob !== "string");

  if (typeof withAll !== "string" && typeof withoutBob !== "string") {
    check(
      "an excluded holder earns nothing",
      !withoutBob.result.tree.entries.some((e) => e.account.toLowerCase() === BOB),
    );

    check(
      "excluding a holder changes the root",
      withAll.result.tree.root !== withoutBob.result.tree.root,
    );

    // Bob's share does not evaporate: it is redistributed to the holders who
    // remain, so the same pool is still paid out.
    const remainingWith = withAll.result.tree.entries
      .filter((e) => e.account.toLowerCase() !== BOB)
      .reduce((sum, e) => sum + e.cumulative, 0n);
    const remainingWithout = withoutBob.result.tree.entries.reduce(
      (sum, e) => sum + e.cumulative,
      0n,
    );

    check("the excluded share goes to other holders", remainingWithout > remainingWith);
  }
}

console.log(failures === 0 ? "\nfinalizer: all checks passed" : `\nfinalizer: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

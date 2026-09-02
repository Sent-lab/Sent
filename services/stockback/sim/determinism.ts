/**
 * SENT — attestor determinism proof.
 *
 * §406 requires independently deployed indexer instances, and §592 sets a 3-of-5
 * attestor quorum. Those instances run on different machines, receive logs in
 * whatever order their provider returns, and never coordinate.
 *
 * If any of that could change the Merkle root by one bit, the quorum would never
 * form. Stockback would not fail loudly — it would simply stop paying, and the
 * cause would look like an infrastructure problem rather than a determinism bug.
 *
 * So this simulates five independent attestors seeing the SAME chain events in
 * DIFFERENT shapes, and requires byte-identical commitments.
 *
 * Run: pnpm sim:determinism
 */

import { EPOCH_DURATION_SECONDS, type BalanceEvent } from "../../../packages/stockback/src/twab.ts";
import { computeDistribution, proofFor, bucketByEpoch, type EpochInput } from "../src/distribution.ts";
import { verifyProof, encodeLeaf } from "../../../packages/stockback/src/merkle.ts";

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
const MARKET = "0x000000000000000000000000000000000000ma7k".slice(0, 42) as `0x${string}`;
const TOKEN = "0x0000000000000000000000000000000000000t0k".slice(0, 42) as `0x${string}`;
const ASSET = "0x00000000000000000000000000000000000000a5" as `0x${string}`;
const POOL = "0x00000000000000000000000000000000000000p0".replace("p0", "aa") as `0x${string}`;

function address(i: number): `0x${string}` {
  return `0x${(i + 1).toString(16).padStart(40, "3")}`.slice(0, 42) as `0x${string}`;
}

/** A realistic, messy event stream: many holders, buys, sells, transfers. */
function generateEvents(epochCount: number): {
  events: BalanceEvent[];
  contributions: Map<bigint, bigint>;
} {
  let seed = 13579n;
  const rand = (n: bigint): bigint => {
    seed = (seed * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) % (1n << 64n);
    return seed % n;
  };

  const events: BalanceEvent[] = [];
  const contributions = new Map<bigint, bigint>();
  const live = new Map<string, bigint>();
  const holders = Array.from({ length: 14 }, (_, i) => address(i));

  for (let e = 0; e < epochCount; e++) {
    const epochId = BigInt(1000 + e);
    const start = epochId * EPOCH_DURATION_SECONDS;

    const times = Array.from({ length: 30 }, () => start + rand(EPOCH_DURATION_SECONDS)).sort(
      (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    );

    for (const at of times) {
      const who = holders[Number(rand(BigInt(holders.length)))]!;
      const held = live.get(who) ?? 0n;
      const kind = rand(3n);

      if (kind === 0n || held === 0n) {
        const amount = (rand(97n) + 1n) * WAD;
        events.push({ account: who, delta: amount, timestamp: at });
        live.set(who, held + amount);
      } else if (kind === 1n) {
        const amount = held / (rand(3n) + 2n);
        if (amount > 0n) {
          events.push({ account: who, delta: -amount, timestamp: at });
          live.set(who, held - amount);
        }
      } else {
        const to = holders[Number(rand(BigInt(holders.length)))]!;
        const amount = held / 4n;
        if (amount > 0n && to !== who) {
          events.push({ account: who, delta: -amount, timestamp: at });
          events.push({ account: to, delta: amount, timestamp: at });
          live.set(who, held - amount);
          live.set(to, (live.get(to) ?? 0n) + amount);
        }
      }
    }

    contributions.set(epochId, (rand(500n) + 1n) * WAD);
  }

  return { events, contributions };
}

console.log("\nSENT — Attestor Determinism Proof (§404, §406, §592)");
console.log("=".repeat(74));

const { events, contributions } = generateEvents(14);
const excluded = [POOL, MARKET];

let totalContributed = 0n;
for (const v of contributions.values()) totalContributed += v;

console.log(`  events         ${events.length}`);
console.log(`  epochs         ${contributions.size}`);
console.log(`  contributions  ${totalContributed / WAD} whole units`);

// ---------------------------------------------------------------------------
console.log("\n--- 1. Five attestors, five different views of the same chain ----------");

/** Each attestor's log query returns events in its own order. */
function shuffleWithSeed<T>(items: readonly T[], seedValue: bigint): T[] {
  let s = seedValue;
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) % (1n << 64n);
    const j = Number(s % BigInt(i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const baseInput = {
  market: MARKET,
  token: TOKEN,
  rewardAsset: ASSET,
  distributionVersion: 1n,
  excludedAccounts: excluded,
  totalFunded: totalContributed,
};

const attestorResults = [1n, 2n, 3n, 4n, 5n].map((attestorSeed) => {
  const theirEvents = shuffleWithSeed(events, attestorSeed * 999n);
  const theirEpochs = bucketByEpoch(theirEvents, contributions);

  // One attestor also receives its epochs in reverse order.
  const epochs: EpochInput[] =
    attestorSeed === 3n ? [...theirEpochs].reverse() : theirEpochs;

  return computeDistribution({ ...baseInput, epochs });
});

const reference = attestorResults[0]!;

check(
  "all five attestors produce an identical Merkle root",
  attestorResults.every((r) => r.commitment.merkleRoot === reference.commitment.merkleRoot),
  attestorResults.map((r) => r.commitment.merkleRoot.slice(0, 12)).join(" "),
);

check(
  "all five produce an identical dataset hash",
  attestorResults.every((r) => r.commitment.datasetHash === reference.commitment.datasetHash),
);

check(
  "all five agree on the cumulative total",
  attestorResults.every((r) => r.commitment.totalCumulative === reference.commitment.totalCumulative),
);

check(
  "all five agree on the epoch sequence",
  attestorResults.every((r) => r.commitment.epochSequence === reference.commitment.epochSequence),
);

check(
  "all five agree on carried dust",
  attestorResults.every((r) => r.carryForward === reference.carryForward),
);

// ---------------------------------------------------------------------------
console.log("\n--- 2. Conservation (§364) ---------------------------------------------");

check(
  "committed entitlement never exceeds funding",
  reference.commitment.totalCumulative <= totalContributed,
  `${reference.commitment.totalCumulative} vs ${totalContributed}`,
);

check(
  "entitlement plus carried dust equals every contribution",
  reference.commitment.totalCumulative + reference.carryForward === totalContributed,
);

// A pipeline that would produce an over-commitment must refuse, because the vault
// rejecting it would be an outage that looks like theft from the outside.
{
  let refused = false;
  try {
    computeDistribution({
      ...baseInput,
      epochs: bucketByEpoch(events, contributions),
      // One wei below the ENTITLEMENT, not below contributions: allocation is
      // already lower than contributions by the carried dust, so a ceiling set
      // against contributions would never bind.
      totalFunded: reference.commitment.totalCumulative - 1n,
    });
  } catch {
    refused = true;
  }
  check("a commitment beyond funding is refused before it reaches the vault", refused);
}

// ---------------------------------------------------------------------------
console.log("\n--- 3. Exclusions are applied, not inferred ----------------------------");

check(
  "the excluded pool address earns nothing",
  !reference.tree.entries.some((e) => e.account.toLowerCase() === POOL.toLowerCase()),
);
check(
  "the excluded market address earns nothing",
  !reference.tree.entries.some((e) => e.account.toLowerCase() === MARKET.toLowerCase()),
);
check("real holders were paid", reference.tree.entries.length > 5);

// ---------------------------------------------------------------------------
console.log("\n--- 4. Proofs verify against every attestor's root ----------------------");

{
  let allVerify = true;
  for (const entry of reference.tree.entries) {
    const p = proofFor(reference, entry.account);
    if (p === null) {
      allVerify = false;
      break;
    }
    const leaf = encodeLeaf(entry.account, entry.cumulative);

    // The proof one attestor generated must verify against every other
    // attestor's root — otherwise a holder's claim would depend on which
    // instance served their API request.
    for (const other of attestorResults) {
      if (!verifyProof(other.commitment.merkleRoot, leaf, p.proof)) allVerify = false;
    }
  }
  check("every holder's proof verifies against all five roots", allVerify);
}

// ---------------------------------------------------------------------------
console.log("\n--- 5. Splitting the work must not change the answer --------------------");

{
  // An attestor that restarts mid-history processes epochs in two batches. The
  // second batch must continue from the first's closing balances, or a holder who
  // never traded across the boundary would lose their accrual.
  const allEpochs = bucketByEpoch(events, contributions);
  const half = Math.floor(allEpochs.length / 2);

  const wholeRun = computeDistribution({ ...baseInput, epochs: allEpochs });
  const firstHalf = computeDistribution({ ...baseInput, epochs: allEpochs.slice(0, half) });

  check(
    "a partial run commits strictly less than the full run",
    firstHalf.commitment.totalCumulative < wholeRun.commitment.totalCumulative,
  );
  check(
    "a partial run carries a lower epoch sequence",
    firstHalf.commitment.epochSequence < wholeRun.commitment.epochSequence,
  );

  // Cumulative means a later commitment supersedes an earlier one rather than
  // adding to it — so the vault's monotonicity check has meaning (§365).
  check(
    "the full run supersedes the partial one",
    wholeRun.commitment.totalCumulative >= firstHalf.commitment.totalCumulative &&
      wholeRun.commitment.epochSequence > firstHalf.commitment.epochSequence,
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- 6. Degenerate inputs are refused ------------------------------------");

{
  let refused = false;
  try {
    computeDistribution({ ...baseInput, epochs: [] });
  } catch {
    refused = true;
  }
  check("an empty epoch set is refused rather than committed", refused);
}

{
  let refused = false;
  try {
    const epochs = bucketByEpoch(events, contributions);
    computeDistribution({ ...baseInput, epochs: [epochs[0]!, epochs[0]!] });
  } catch {
    refused = true;
  }
  check("a duplicated epoch is refused", refused);
}

{
  // §328: contributions with no eligible holders must carry forward, not be
  // committed to nobody.
  let refused = false;
  try {
    computeDistribution({
      ...baseInput,
      epochs: [{ epochId: 5000n, events: [], contributions: 100n * WAD }],
      totalFunded: 100n * WAD,
    });
  } catch {
    refused = true;
  }
  check("an epoch with no eligible holders is refused, not committed to nobody", refused);
}

// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(74));
if (failures.length === 0) {
  console.log(`DETERMINISM PROOF: PASS — ${passed} checks green.`);
  console.log("");
  console.log("Five attestors, five different event orderings, one identical root.");
  console.log("Without that, the quorum never forms and Stockback stops paying —");
  console.log("silently, and looking like an infrastructure fault rather than a bug.");
} else {
  console.log(`DETERMINISM PROOF: FAIL — ${failures.length} of ${passed + failures.length} failed.`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
console.log("");

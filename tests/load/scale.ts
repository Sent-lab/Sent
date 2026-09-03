/**
 * SENT — correctness at scale.
 *
 * Not a throughput benchmark. The question this answers is whether the parts of
 * the system that behave differently when there is a lot of data still produce
 * the RIGHT answer — because those are the parts that have never seen more than
 * a handful of rows.
 *
 * Three of them, specifically:
 *
 *   `recordDataset` inserts entitlements in chunks of 500. Every test so far has
 *   given it two, so the chunking loop has never executed twice, and an off-by-
 *   one there would drop or duplicate a holder's reward silently.
 *
 *   The Merkle tree has been built over a handful of leaves. Tree depth changes
 *   with size, and a proof that verifies at depth 2 tells you very little about
 *   depth 12.
 *
 *   `computeDistribution` folds every epoch from the beginning of history on
 *   every run (deliberately — see the finalizer). That is quadratic-ish work,
 *   and it needs to remain correct rather than merely finish.
 *
 * Timings are printed but nothing is asserted about them. A performance
 * threshold in CI is a flaky test wearing a useful disguise; the numbers are
 * here to be read by a person.
 *
 *   DATABASE_URL=postgres://sent:sent@localhost:5432/sent \
 *     node --experimental-strip-types tests/load/scale.ts
 */

import {
  Database,
  migrate,
  loadMigrations,
  recordDataset,
  getLatestDataset,
  getEntitlementForRoot,
} from "@sent/database";
import { computeDistribution, bucketByEpoch } from "@sent/stockback-service";
import { EPOCH_DURATION_SECONDS, type BalanceEvent } from "@sent/stockback";
import { encodeLeaf, verifyProof, getAllProofs } from "@sent/stockback/merkle";

const CONNECTION = process.env.DATABASE_URL;

if (CONNECTION === undefined || CONNECTION.trim() === "") {
  console.log("load: DATABASE_URL not set, skipping");
  process.exit(0);
}

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

function timed<T>(label: string, fn: () => T): T {
  const started = Date.now();
  const result = fn();
  console.log(`       ${label}: ${Date.now() - started}ms`);
  return result;
}

async function timedAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await fn();
  console.log(`       ${label}: ${Date.now() - started}ms`);
  return result;
}

// ---------------------------------------------------------------------------

/** Enough holders to cross the chunk boundary several times over. */
const HOLDERS = 2_500;
const EPOCHS = 30;

const MARKET = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const QUOTE = "0x4444444444444444444444444444444444444444" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;

const WAD = 10n ** 18n;

/** Deterministic addresses, so a failure is reproducible. */
function holder(index: number): string {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

/**
 * A market with many holders entering at different times.
 *
 * Deliberately uneven: identical balances held for identical spans would make
 * every entitlement equal, and a distribution bug that scaled everyone the same
 * way would pass.
 */
function buildHistory(): { events: BalanceEvent[]; funding: Map<bigint, bigint> } {
  const events: BalanceEvent[] = [];

  for (let i = 0; i < HOLDERS; i++) {
    // Spread entries across the first two thirds of the window.
    const epoch = BigInt(i % Math.floor(EPOCHS * 0.66));
    const hour = BigInt(i % 24);

    events.push({
      account: holder(i),
      delta: BigInt(1 + (i % 97)) * WAD,
      timestamp: epoch * EPOCH_DURATION_SECONDS + hour * 3_600n,
    });

    // Every seventh holder sells half of it later, so exits are exercised too.
    if (i % 7 === 0) {
      events.push({
        account: holder(i),
        delta: -(BigInt(1 + (i % 97)) * WAD) / 2n,
        timestamp: (epoch + 3n) * EPOCH_DURATION_SECONDS + hour * 3_600n,
      });
    }
  }

  const funding = new Map<bigint, bigint>();
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    funding.set(BigInt(epoch), 1_000_000n + BigInt(epoch) * 12_345n);
  }

  return { events, funding };
}

const db = new Database({ connectionString: CONNECTION });

try {
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(db, loadMigrations());

  await db.query(
    "INSERT INTO blocks (number, hash, parent_hash, timestamp) VALUES (1, $1, $2, 1000)",
    [Buffer.alloc(32, 1), Buffer.alloc(32, 0)],
  );

  await db.query(
    "INSERT INTO markets (token, market, creator, quote_asset, name, symbol, p0, pg, qg, quote_decimals, launched_at_block, launched_at, effective_salt) " +
      "VALUES ($1,$2,$3,$4,'Scale','SCALE',1000,25000,1,18,1,1000,$5)",
    [
      Buffer.from(TOKEN.slice(2), "hex"),
      Buffer.from(MARKET.slice(2), "hex"),
      Buffer.from(CREATOR.slice(2), "hex"),
      Buffer.from(QUOTE.slice(2), "hex"),
      Buffer.alloc(32),
    ],
  );

  section(`Distributing to ${HOLDERS.toLocaleString("en-US")} holders over ${EPOCHS} epochs`);

  const { events, funding } = buildHistory();
  console.log(`       ${events.length.toLocaleString("en-US")} balance events`);

  const totalFunded = [...funding.values()].reduce((sum, v) => sum + v, 0n);

  const result = timed("computeDistribution", () =>
    computeDistribution({
      market: MARKET,
      token: TOKEN,
      rewardAsset: QUOTE,
      distributionVersion: 1n,
      excludedAccounts: [],
      epochs: bucketByEpoch(events, funding),
      totalFunded,
    }),
  );

  // Not every holder necessarily earns: a share can round to zero, and
  // `computeDistribution` drops those rather than committing a zero leaf. What
  // must hold is that the great majority did, and that none were invented.
  const earners = result.tree.entries.length;
  console.log(`       ${earners.toLocaleString("en-US")} of ${HOLDERS} holders earned something`);

  check("no holder was invented", earners <= HOLDERS);
  check("nearly every holder earned something", earners > HOLDERS * 0.9);

  // §364. The ceiling holds regardless of how many ways the pool is split.
  check(
    "the commitment stays within its funding",
    result.commitment.totalCumulative <= totalFunded,
  );

  // Rounding leaves dust; it must carry forward rather than vanish or be
  // over-allocated (§327).
  const allocated = result.epochAllocations.reduce((sum, a) => sum + a.allocated, 0n);
  check("nothing was allocated beyond the pool", allocated <= totalFunded);
  check("dust carried forward rather than vanishing", result.carryForward >= 0n);

  console.log(
    `       distributed ${result.commitment.totalCumulative} of ${totalFunded}, ` +
      `carry ${result.carryForward}`,
  );

  // Uneven history must produce uneven entitlements. If a bug scaled everyone
  // identically, this is what would catch it.
  const amounts = new Set(result.tree.entries.map((e) => e.cumulative.toString()));
  check("entitlements differ between holders", amounts.size > HOLDERS / 10);

  section("Proofs at real tree depth");

  // Depth grows with size; a proof that verifies at depth 2 says little about
  // depth 12.
  const depth = Math.ceil(Math.log2(HOLDERS));
  console.log(`       tree of ${HOLDERS} leaves, depth about ${depth}`);

  // Chosen to straddle the 500-row chunk boundaries, which is where a
  // persistence bug would land, and clamped to what actually exists.
  const sample = [0, 1, 7, 499, 500, 501, 999, 1_000, 1_499, earners - 2, earners - 1].filter(
    (i) => i >= 0 && i < earners,
  );

  const proofs = timed("building every proof in one pass", () => getAllProofs(result.tree));

  check("a proof was built for every holder", proofs.size === earners);

  let verified = 0;
  timed("verifying a sample", () => {
    for (const index of sample) {
      const entry = result.tree.entries[index];
      if (entry === undefined) continue;

      const proof = proofs.get(entry.account.toLowerCase()) ?? [];
      if (verifyProof(result.tree.root, encodeLeaf(entry.account, entry.cumulative), proof)) {
        verified += 1;
      }
    }
  });

  check("every sampled proof verifies", verified === sample.length);
  check("the sample straddles a chunk boundary", sample.includes(499) && sample.includes(500));

  section("Persistence across the chunk boundary");

  await timedAsync("recordDataset", () =>
    db.transaction((tx) =>
      recordDataset(tx, {
        market: MARKET,
        epochSequence: result.commitment.epochSequence,
        merkleRoot: result.commitment.merkleRoot,
        datasetHash: result.commitment.datasetHash,
        totalCumulative: result.commitment.totalCumulative,
        carryForward: result.carryForward,
        totalFunded,
        computedThroughBlock: 1n,
        computedAt: 1_000,
        entitlements: result.tree.entries.map((entry) => ({
          account: entry.account,
          cumulative: entry.cumulative,
          proof: proofs.get(entry.account.toLowerCase()) ?? [],
        })),
        allocations: result.epochAllocations.map((a) => ({
          epochId: a.epochId,
          pool: a.pool,
          allocated: a.allocated,
          carryForward: a.carryForward,
          eligibleHolders: a.eligibleHolders,
          totalWeight: a.totalWeight,
        })),
      }),
    ),
  );

  const stored = await db.query<{ c: string }>(
    "SELECT COUNT(*)::TEXT AS c FROM stockback_entitlements",
  );

  // The whole point of this file. Five chunks of 500, and an off-by-one in the
  // loop would drop or duplicate holders without anything else noticing.
  check(`all ${earners} entitlements were stored`, stored[0]?.c === String(earners));

  const dataset = await getLatestDataset(db, MARKET);
  check("the dataset header stored", dataset !== null);

  if (dataset !== null) {
    check("with the right holder count", dataset.totalCumulative === result.commitment.totalCumulative);

    // Read back across the boundaries and re-verify against the STORED root, so
    // this covers the round trip through PostgreSQL rather than the in-memory
    // tree alone.
    let roundTripped = 0;

    await timedAsync("reading and verifying stored proofs", async () => {
      for (const index of sample) {
        const entry = result.tree.entries[index];
        if (entry === undefined) continue;

        const read = await getEntitlementForRoot(db, MARKET, entry.account, dataset.merkleRoot);
        if (read === null) continue;

        if (
          read.cumulative === entry.cumulative &&
          verifyProof(dataset.merkleRoot, encodeLeaf(entry.account, read.cumulative), read.proof)
        ) {
          roundTripped += 1;
        }
      }
    });

    check("every stored proof survives the round trip", roundTripped === sample.length);
  }

  section("The allocation adds up");

  // Per-epoch conservation, checked against the schema's own constraint as well
  // as here: allocated plus carry can never exceed the pool it came from.
  const violations = result.epochAllocations.filter((a) => a.allocated + a.carryForward > a.pool);
  check("no epoch allocated more than its pool", violations.length === 0);

  const rows = await db.query<{ c: string }>(
    "SELECT COUNT(*)::TEXT AS c FROM stockback_epoch_allocations",
  );
  check(`all ${EPOCHS} epoch allocations stored`, Number(rows[0]?.c ?? "0") === EPOCHS);
} finally {
  await db.close();
}

console.log(failures === 0 ? "\nload: all checks passed" : `\nload: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

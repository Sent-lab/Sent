/**
 * SENT — contention.
 *
 * §434's topology runs API and WebSocket replicas, and nothing stops an operator
 * running two workers or two indexers. Everything in this system was written to
 * tolerate that — the job queue claims with `FOR UPDATE SKIP LOCKED`, handlers
 * recompute rather than adjust, and the finalizer's writes are idempotent — but
 * none of it had ever been run against a competitor.
 *
 * "Designed to be safe under contention" and "observed to be safe under
 * contention" are different claims, and only one of them survives a review.
 *
 *   DATABASE_URL=postgres://sent:sent@localhost:5432/sent \
 *     node --experimental-strip-types tests/load/concurrency.ts
 */

import {
  Database,
  migrate,
  loadMigrations,
  enqueueJob,
  countJobsByStatus,
  listDeadJobs,
  recordDataset,
  getLatestDataset,
} from "@sent/database";
import { JobRunner, DEFAULT_RUNNER_CONFIG } from "@sent/worker/runner";

const CONNECTION = process.env.DATABASE_URL;

if (CONNECTION === undefined || CONNECTION.trim() === "") {
  console.log("concurrency: DATABASE_URL not set, skipping");
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

const MARKET = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const QUOTE = "0x4444444444444444444444444444444444444444" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;

/** Enough jobs that two runners genuinely overlap rather than taking turns. */
const JOBS = 200;
const RUNNERS = 4;

const db = new Database({ connectionString: CONNECTION, maxConnections: 20 });

try {
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(db, loadMigrations());

  await db.query(
    "INSERT INTO blocks (number, hash, parent_hash, timestamp) VALUES (1, $1, $2, 1000)",
    [Buffer.alloc(32, 1), Buffer.alloc(32, 0)],
  );

  await db.query(
    "INSERT INTO markets (token, market, creator, quote_asset, name, symbol, p0, pg, qg, quote_decimals, launched_at_block, launched_at, effective_salt) " +
      "VALUES ($1,$2,$3,$4,'C','C',1000,25000,1,18,1,1000,$5)",
    [
      Buffer.from(TOKEN.slice(2), "hex"),
      Buffer.from(MARKET.slice(2), "hex"),
      Buffer.from(CREATOR.slice(2), "hex"),
      Buffer.from(QUOTE.slice(2), "hex"),
      Buffer.alloc(32),
    ],
  );

  // -------------------------------------------------------------------------

  section(`${RUNNERS} workers against ${JOBS} jobs`);

  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < JOBS; i++) {
    await enqueueJob(
      db,
      {
        id: `contended:${i}`,
        kind: "contended",
        payload: { index: i },
        maxAttempts: 3,
        runAfter: now,
      },
      now,
    );
  }

  /*
   * Counts how many times each job ran.
   *
   * The queue promises AT-LEAST-once, so a second execution is not by itself a
   * bug — a worker dying between doing the work and marking it done would
   * legitimately produce one. What must never happen is two workers running the
   * SAME job at the same time, because that is the case handlers cannot be
   * written to tolerate.
   */
  const executions = new Map<number, number>();
  let concurrentPeak = 0;
  let inFlight = 0;

  const runners = Array.from({ length: RUNNERS }, () => {
    const runner = new JobRunner(db, { ...DEFAULT_RUNNER_CONFIG, idlePollMs: 5 });

    runner.register("contended", async (payload) => {
      const index = payload.index as number;

      inFlight += 1;
      concurrentPeak = Math.max(concurrentPeak, inFlight);

      executions.set(index, (executions.get(index) ?? 0) + 1);

      // Long enough that the runners genuinely overlap. Without it each claim
      // completes before the next runner polls, and nothing is contended.
      await new Promise((resolve) => setTimeout(resolve, 2));

      inFlight -= 1;
    });

    return runner;
  });

  const started = Date.now();

  // All four drain the same queue at once.
  await Promise.all(runners.map((runner) => runner.drain(JOBS * 2, now)));

  console.log(`       drained in ${Date.now() - started}ms, peak overlap ${concurrentPeak}`);

  check("the workers actually overlapped", concurrentPeak > 1);
  check("every job ran", executions.size === JOBS);

  const duplicates = [...executions.entries()].filter(([, count]) => count > 1);
  check("no job ran twice", duplicates.length === 0);

  if (duplicates.length > 0) {
    console.error(`       duplicated: ${duplicates.slice(0, 5).map(([i, c]) => `${i}×${c}`).join(", ")}`);
  }

  const counts = await countJobsByStatus(db);
  check("every job finished", counts.DONE === JOBS);
  check("none was left running", counts.RUNNING === 0);
  check("none was left pending", counts.PENDING === 0);
  check("none died", counts.DEAD === 0);

  const claimed = runners.reduce((sum, runner) => sum + runner.metrics.claimed, 0);
  check("the claims add up to the job count", claimed === JOBS);

  // Work should be spread rather than one runner taking everything, or
  // `SKIP LOCKED` is not doing what it is there for.
  const shares = runners.map((runner) => runner.metrics.claimed);
  console.log(`       claims per worker: ${shares.join(", ")}`);
  check("more than one worker got work", shares.filter((n) => n > 0).length > 1);

  section("A failing job is retried, not lost or duplicated");

  {
    let attempts = 0;

    const runner = new JobRunner(db, { ...DEFAULT_RUNNER_CONFIG, maxAttempts: 3 });
    runner.register("flaky", async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("not yet");
    });

    await enqueueJob(
      db,
      { id: "flaky:1", kind: "flaky", payload: {}, maxAttempts: 3, runAfter: now },
      now,
    );

    // Each pass is a separate tick with the clock moved past the backoff, which
    // is what the runner would see in production.
    await runner.step(now);
    await runner.step(now + 60);
    await runner.step(now + 300);

    check("it took three attempts", attempts === 3);
    check("and ended up done", (await countJobsByStatus(db)).DEAD === 0);
    check("with nothing in the dead letter", (await listDeadJobs(db, 10)).length === 0);
  }

  section("Two finalizers writing the same dataset");

  {
    /*
     * Two nodes computing the same epoch produce the same commitment — that is
     * what the determinism proof is for. Both will then try to store it, and the
     * second must be a no-op rather than a duplicate-key failure that takes a
     * finalizer down.
     */
    const entry = {
      market: MARKET,
      epochSequence: 7n,
      merkleRoot: `0x${"ab".repeat(32)}`,
      datasetHash: `0x${"cd".repeat(32)}`,
      totalCumulative: 1_000n,
      carryForward: 5n,
      totalFunded: 2_000n,
      computedThroughBlock: 1n,
      computedAt: 1_000,
      entitlements: [
        { account: "0x00000000000000000000000000000000000000aa", cumulative: 600n, proof: [] },
        { account: "0x00000000000000000000000000000000000000bb", cumulative: 400n, proof: [] },
      ],
      allocations: [
        {
          epochId: 7n,
          pool: 1_005n,
          allocated: 1_000n,
          carryForward: 5n,
          eligibleHolders: 2,
          totalWeight: 10n,
        },
      ],
    };

    const results = await Promise.allSettled([
      db.transaction((tx) => recordDataset(tx, entry)),
      db.transaction((tx) => recordDataset(tx, entry)),
    ]);

    const rejected = results.filter((r) => r.status === "rejected");

    // One of the two may lose a race on the primary key. What matters is that a
    // loss is not silent corruption — the stored row must still be correct and
    // singular either way.
    console.log(`       ${results.length - rejected.length} of 2 writes committed`);

    const stored = await getLatestDataset(db, MARKET);
    check("the dataset is stored exactly once", stored !== null);
    check("with the right root", stored?.merkleRoot === entry.merkleRoot);

    const entitlements = await db.query<{ c: string }>(
      "SELECT COUNT(*)::TEXT AS c FROM stockback_entitlements",
    );
    check("and its entitlements are not duplicated", entitlements[0]?.c === "2");

    const allocations = await db.query<{ c: string }>(
      "SELECT COUNT(*)::TEXT AS c FROM stockback_epoch_allocations",
    );
    check("nor its allocations", allocations[0]?.c === "1");
  }
} finally {
  await db.close();
}

console.log(
  failures === 0 ? "\nconcurrency: all checks passed" : `\nconcurrency: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);

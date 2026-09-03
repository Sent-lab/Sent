/**
 * SENT — worker entry point.
 *
 * Runs the job loop and, separately, the periodic producer that enqueues the
 * sweep. The two are deliberately different cadences: work is claimed as fast as
 * it appears, while the sweep is scheduled once an hour and deduplicated by its
 * deterministic id.
 */

import { Database, headBlockIndexed, countJobsByStatus } from "@sent/database";
import { databaseEnv, loadAll } from "@sent/config/env";
import { createLogger } from "@sent/observability/logger";
import { serveOperations } from "@sent/observability/server";

import { JobRunner, DEFAULT_RUNNER_CONFIG, logLine } from "./runner.ts";
import { registerAll } from "./jobs.ts";
import { scheduleSweep } from "./schedule.ts";
import { createWorkerRegistry } from "./observability.ts";

/** How far back the health sweep looks for gaps. */
const SWEEP_LOOKBACK_BLOCKS = 10_000n;
const SWEEP_INTERVAL_MS = 3_600_000;

async function main(): Promise<void> {
  const { db: dbConfig } = loadAll({ db: databaseEnv });

  const log = createLogger({ service: "worker" });

  const db = new Database(dbConfig);
  const runner = new JobRunner(db, DEFAULT_RUNNER_CONFIG);

  registerAll(db, (kind, handler) => runner.register(kind, handler));

  /*
   * Queue depth, polled rather than read at scrape time.
   *
   * Every gauge in this file reads an in-memory counter and costs nothing, but
   * these two are `COUNT(*)` over a table. Doing that inside `render()` would
   * make the scrape endpoint issue database queries — so a monitoring system
   * scraping every fifteen seconds would be adding load to the thing it is
   * watching, and a slow database would make the scrape time out exactly when
   * its numbers are most needed.
   *
   * Null until the first successful read, and null again after a failure: a
   * queue depth of zero during a database outage is the reassuring reading of
   * "we cannot see the queue at all".
   */
  let depth: { pending: number; dead: number } | null = null;

  const refreshDepth = setInterval(() => {
    void (async () => {
      try {
        const counts = await countJobsByStatus(db);
        depth = { pending: counts.PENDING ?? 0, dead: counts.DEAD ?? 0 };
      } catch {
        depth = null;
      }
    })();
  }, 15_000);

  const metrics = createWorkerRegistry({
    claimed: () => runner.metrics.claimed,
    succeeded: () => runner.metrics.succeeded,
    retried: () => runner.metrics.retried,
    deadLettered: () => runner.metrics.deadLettered,
    unknownKind: () => runner.metrics.unknownKind,
    handlerMs: () => runner.metrics.handlerMs,
    pending: () => depth?.pending ?? null,
    dead: () => depth?.dead ?? null,
  });

  const operations = await serveOperations({
    port: Number(process.env.WORKER_METRICS_PORT ?? 9103),
    registry: metrics,
    logger: log,
    // The runner either has its loop or it does not. Queue depth is
    // deliberately not part of liveness: a worker with nothing to do is
    // healthy, and restarting it would not create work.
    liveness: () => ({ ok: true }),
  });

  const sweep = setInterval(() => {
    void (async () => {
      try {
        const head = await headBlockIndexed(db);
        const queued = await scheduleSweep(db, head, SWEEP_LOOKBACK_BLOCKS);
        if (queued > 0) console.info(logLine({ level: "info", event: "sweep.scheduled", queued }));
      } catch (error) {
        console.error(
          logLine({
            level: "error",
            event: "sweep.failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    })();
  }, SWEEP_INTERVAL_MS);

  const shutdown = async (signal: string): Promise<void> => {
    console.info(logLine({ level: "info", event: "worker.shutdown", signal, ...runner.metrics }));
    clearInterval(sweep);
    clearInterval(refreshDepth);
    runner.stop();
    await operations.close();
    await db.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.info(logLine({ level: "info", event: "worker.started" }));
  await runner.start();
}

main().catch((error: unknown) => {
  console.error(
    logLine({
      level: "error",
      event: "worker.start_failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});

/**
 * SENT — finalizer entry point.
 *
 * Computes distributions on a loop. It holds no keys and submits nothing, so it
 * needs a database and a clock and nothing else — no RPC, because everything it
 * reads has already been settled and written by the indexer (§335).
 */

import { Database } from "@sent/database";
import { databaseEnv, loadAll } from "@sent/config/env";

import { createLogger } from "@sent/observability/logger";
import { serveOperations } from "@sent/observability/server";

import { Finalizer, DEFAULT_FINALIZER_CONFIG } from "./finalizer.ts";

async function main(): Promise<void> {
  const { db: dbConfig } = loadAll({ db: databaseEnv });

  const log = createLogger({ service: "finalizer" });

  const db = new Database(dbConfig);
  const finalizer = new Finalizer(db, DEFAULT_FINALIZER_CONFIG);

  /*
   * Liveness for a service whose healthy state is doing nothing.
   *
   * On a quiet deployment the finalizer legitimately writes no datasets for
   * days, so publication age cannot be the liveness signal — it would report a
   * dead process every weekend. What it CAN assert is that the loop is still
   * turning: if no pass has completed in several intervals, this process is
   * wedged rather than idle.
   */
  const stalledAfterMs = DEFAULT_FINALIZER_CONFIG.runIntervalMs * 5;

  const operations = await serveOperations({
    port: Number(process.env.FINALIZER_METRICS_PORT ?? 9102),
    registry: finalizer.metrics,
    logger: log,
    liveness: () => {
      const last = finalizer.lastCompletedRun();
      // Before the first pass there is nothing to be late for.
      if (last === null) return { ok: true };

      const age = Date.now() / 1000 - last;
      return age * 1_000 < stalledAfterMs
        ? { ok: true }
        : { ok: false, reason: `no completed pass in ${Math.round(age)}s` };
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info("shutting down after the current pass", { signal });
    finalizer.stop();
    await operations.close();
    await db.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log.info("running", { runIntervalMs: DEFAULT_FINALIZER_CONFIG.runIntervalMs });
  await finalizer.start();
}

main().catch((error: unknown) => {
  console.error(
    `[finalizer] failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});

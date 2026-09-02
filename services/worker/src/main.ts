/**
 * SENT — worker entry point.
 *
 * Runs the job loop and, separately, the periodic producer that enqueues the
 * sweep. The two are deliberately different cadences: work is claimed as fast as
 * it appears, while the sweep is scheduled once an hour and deduplicated by its
 * deterministic id.
 */

import { Database, headBlockIndexed } from "@sent/database";
import { databaseEnv, loadAll } from "@sent/config/env";

import { JobRunner, DEFAULT_RUNNER_CONFIG, logLine } from "./runner.ts";
import { registerAll } from "./jobs.ts";
import { scheduleSweep } from "./schedule.ts";

/** How far back the health sweep looks for gaps. */
const SWEEP_LOOKBACK_BLOCKS = 10_000n;
const SWEEP_INTERVAL_MS = 3_600_000;

async function main(): Promise<void> {
  const { db: dbConfig } = loadAll({ db: databaseEnv });

  const db = new Database(dbConfig);
  const runner = new JobRunner(db, DEFAULT_RUNNER_CONFIG);

  registerAll(db, (kind, handler) => runner.register(kind, handler));

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
    runner.stop();
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

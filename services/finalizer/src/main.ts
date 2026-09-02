/**
 * SENT — finalizer entry point.
 *
 * Computes distributions on a loop. It holds no keys and submits nothing, so it
 * needs a database and a clock and nothing else — no RPC, because everything it
 * reads has already been settled and written by the indexer (§335).
 */

import { Database } from "@sent/database";
import { databaseEnv, loadAll } from "@sent/config/env";

import { Finalizer, DEFAULT_FINALIZER_CONFIG } from "./finalizer.ts";

async function main(): Promise<void> {
  const { db: dbConfig } = loadAll({ db: databaseEnv });

  const db = new Database(dbConfig);
  const finalizer = new Finalizer(db, DEFAULT_FINALIZER_CONFIG);

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[finalizer] ${signal} received, stopping after the current pass`);
    finalizer.stop();
    await db.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.info("[finalizer] running");
  await finalizer.start();
}

main().catch((error: unknown) => {
  console.error(
    `[finalizer] failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});

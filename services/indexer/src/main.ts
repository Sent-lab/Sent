/**
 * SENT — indexer entry point.
 *
 * Applies migrations, then follows the chain. Migrations run here rather than in
 * a separate container because the indexer is the only writer that creates the
 * projection: a schema older than the code writing to it fails on the first
 * insert, which is a worse way to find out.
 */

import { Database, migrate, loadMigrations } from "@sent/database";
import { chainEnv, databaseEnv, loadAll } from "@sent/config/env";
import { HYPEREVM_CHAIN_ID, assertProductionConfigReady } from "@sent/config";

import { createLogger } from "@sent/observability/logger";
import { serveOperations } from "@sent/observability/server";

import { Indexer, DEFAULT_CONFIG } from "./ingest.ts";

async function main(): Promise<void> {
  const { db: dbConfig, chain } = loadAll({ db: databaseEnv, chain: chainEnv });


  // §279 forbids placeholders in production. On mainnet the verified facts must
  // actually be present; applying this on every chain would block local work for
  // no safety benefit, so it is gated the same way the deploy script's guards are.
  if (chain.chainId === HYPEREVM_CHAIN_ID) assertProductionConfigReady();

  const log = createLogger({ service: "indexer" }).child({ chainId: chain.chainId });

  const db = new Database(dbConfig);

  const applied = await migrate(db, loadMigrations());
  if (applied.length > 0) log.info("applied migrations", { migrations: applied });

  const indexer = new Indexer(db, {
    ...DEFAULT_CONFIG,
    rpcUrl: chain.rpcUrl,
    chainId: chain.chainId,
    factory: chain.factory,
    rewardVault: chain.rewardVault,
    startBlock: chain.startBlock,
    confirmations: chain.confirmations,
  });

  /*
   * §437's scrape and liveness surface.
   *
   * The indexer is a loop with no port, so without this an operator cannot
   * scrape it and an orchestrator cannot ask whether it is alive — and a
   * background process that has silently stopped looks exactly like one with
   * nothing to do.
   *
   * Liveness is deliberately NOT freshness. It reports whether this process
   * reached the RPC on its last pass, not whether the projection is caught up:
   * a service that restarted itself every time the chain was slow would turn a
   * degraded dependency into an outage.
   */
  const operations = await serveOperations({
    port: Number(process.env.INDEXER_METRICS_PORT ?? 9101),
    registry: indexer.metrics,
    logger: log,
    liveness: () => {
      const status = indexer.status();
      return status.connected
        ? { ok: true }
        : { ok: false, reason: "the last pass did not reach the RPC" };
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info("shutting down after the current tick", { signal });
    indexer.stop();
    await operations.close();
    await db.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log.info("following chain", { blockNumber: chain.startBlock, factory: chain.factory });
  await indexer.start();
}

main().catch((error: unknown) => {
  // Still console at this point: the failure may BE the logger's construction,
  // and a start-up error that cannot be printed is the worst kind.
  console.error(
    `[indexer] failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});

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

import { Indexer, DEFAULT_CONFIG } from "./ingest.ts";

async function main(): Promise<void> {
  const { db: dbConfig, chain } = loadAll({ db: databaseEnv, chain: chainEnv });


  // §279 forbids placeholders in production. On mainnet the verified facts must
  // actually be present; applying this on every chain would block local work for
  // no safety benefit, so it is gated the same way the deploy script's guards are.
  if (chain.chainId === HYPEREVM_CHAIN_ID) assertProductionConfigReady();

  const db = new Database(dbConfig);

  const applied = await migrate(db, loadMigrations());
  if (applied.length > 0) console.info(`[indexer] applied migrations: ${applied.join(", ")}`);

  const indexer = new Indexer(db, {
    ...DEFAULT_CONFIG,
    rpcUrl: chain.rpcUrl,
    chainId: chain.chainId,
    factory: chain.factory,
    rewardVault: chain.rewardVault,
    startBlock: chain.startBlock,
    confirmations: chain.confirmations,
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[indexer] ${signal} received, stopping after the current tick`);
    indexer.stop();
    await db.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await indexer.start();
  console.info(`[indexer] following chain ${chain.chainId} from block ${chain.startBlock}`);
}

main().catch((error: unknown) => {
  console.error(
    `[indexer] failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});

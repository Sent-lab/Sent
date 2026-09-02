/**
 * SENT — API entry point.
 *
 * Reads configuration, opens the database, serves. Everything it can refuse to
 * do, it refuses before binding a port: a service that accepts connections and
 * then discovers it is misconfigured has already told a load balancer it is
 * healthy.
 */

import { Database } from "@sent/database";
import { apiEnv, chainEnv, databaseEnv, loadAll } from "@sent/config/env";
import {
  XSTOCK_ALLOWLIST,
  HYPEREVM_CHAIN_ID,
  assertProductionConfigReady,
} from "@sent/config";

import { startServer } from "./server.ts";

async function main(): Promise<void> {
  const { db: dbConfig, chain, api } = loadAll({
    db: databaseEnv,
    chain: chainEnv,
    api: apiEnv,
  });


  // §279 forbids placeholders in production. On mainnet the verified facts must
  // actually be present; applying this on every chain would block local work for
  // no safety benefit, so it is gated the same way the deploy script's guards are.
  if (chain.chainId === HYPEREVM_CHAIN_ID) assertProductionConfigReady();

  const db = new Database(dbConfig);

  // Quote symbols come from the verified allowlist, never from the token's own
  // `symbol()`. A token is free to call itself anything, and an explore page
  // that rendered an attacker-chosen string next to a price is a phishing
  // surface rather than a display bug (§699).
  const quoteSymbols = new Map(
    XSTOCK_ALLOWLIST.filter((entry) => entry.verified).map((entry) => [entry.erc20, entry.symbol]),
  );

  const app = await startServer(db, {
    port: api.port,
    host: api.host,
    chainId: chain.chainId,
    rpcUrl: chain.rpcUrl,
    confirmations: chain.confirmations,
    refreshIntervalMs: api.refreshIntervalMs,
    quoteSymbols,
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[api] ${signal} received, draining`);
    await app.close();
    await db.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.info(`[api] listening on ${api.host}:${api.port}`);
}

main().catch((error: unknown) => {
  console.error(`[api] failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

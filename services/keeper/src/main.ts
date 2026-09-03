/**
 * SENT — keeper entry point.
 *
 * IT STARTS WITHOUT A KEY, ON PURPOSE
 * -----------------------------------
 * `KEEPER_PRIVATE_KEY` is optional and the process runs watch-only without it.
 * That looks like a missing guard, and it is the opposite of one.
 *
 * This service does two things: it finalises stalled graduations, and it is the
 * thing that NOTICES stalled graduations. If it refused to boot without a key,
 * then a deployment with no key configured would also have no alerting — and
 * the first symptom of "nobody is finalising" would be silence, which is what
 * a healthy keeper also produces.
 *
 * So the metrics come up either way, and `keeper_can_send` is a gauge rather
 * than a startup condition. An operator running watch-only sees the pending
 * count and the wait, and can act on either.
 *
 * THE LARGE BLOCK LANE IS AN OPERATOR STEP THIS PROCESS CANNOT TAKE
 * ----------------------------------------------------------------
 * A finalise needs ~5.4M gas and HyperEVM's default lane caps at 3,000,000
 * (V-20). The keeper's account must be opted into the large lane, and that is a
 * Hyperliquid L1 action rather than an EVM call — nothing here can perform it,
 * and V-20 records explicitly that the opt-in mechanism has NOT been verified
 * first-hand.
 *
 * `FINALISE_GAS_LIMIT` is deliberately above the default-lane ceiling so that
 * an un-opted account fails loudly at send time instead of posting transactions
 * that sit unmined forever. The runbook covers the rest.
 */

import { Database, marketsAwaitingFinalisation } from "@sent/database";
import { databaseEnv, chainEnv, keeperEnv, loadAll } from "@sent/config/env";
import { createLogger } from "@sent/observability/logger";
import { serveOperations } from "@sent/observability/server";

import { sweep, type PendingMarket } from "./keeper.ts";
import { createChainSide, createDeps } from "./chain.ts";
import { createKeeperRegistry } from "./observability.ts";

async function main(): Promise<void> {
  const {
    db: dbConfig,
    chain: chainConfig,
    keeper: keeperConfig,
  } = loadAll({ db: databaseEnv, chain: chainEnv, keeper: keeperEnv });

  const log = createLogger({ service: "keeper" });

  const db = new Database(dbConfig);

  const chain = createChainSide({
    rpcUrl: chainConfig.rpcUrl,
    chainId: chainConfig.chainId,
    privateKey: keeperConfig.privateKey,
    minBalanceWei: keeperConfig.minBalanceWei,
  });

  const deps = createDeps(chain, async (): Promise<readonly PendingMarket[]> => {
    const rows = await marketsAwaitingFinalisation(db);
    return rows.map((r) => ({
      market: r.market,
      symbol: r.symbol,
      waitingBlocks: r.waitingBlocks,
    }));
  });

  let last: Awaited<ReturnType<typeof sweep>> | null = null;
  let lastSweepAt: number | null = null;
  let balance: bigint | null = null;
  let sendable = false;

  const registry = createKeeperRegistry({
    pending: () => last?.pending ?? null,
    worstWaitBlocks: () => last?.worstWaitBlocks ?? null,
    failed: () => last?.failed ?? null,
    stalledThreshold: keeperConfig.stalledAfterBlocks,
    canSend: () => sendable,
    balanceWei: () => balance,
    lastSweepAt: () => lastSweepAt,
  });

  const operations = await serveOperations({
    port: Number(process.env.KEEPER_METRICS_PORT ?? 9105),
    registry,
    logger: log,
    /*
     * Liveness is about the LOOP, not about the work.
     *
     * A keeper with nothing pending is healthy, and so is a watch-only one -
     * restarting either creates nothing. What is not healthy is a sweep loop
     * that has stopped running, because then the pending count freezes at
     * whatever it last was and the alert on it silently stops being true.
     */
    liveness: () => {
      const at = lastSweepAt;
      if (at === null) return { ok: true };

      const stale = Date.now() - at > keeperConfig.pollIntervalMs * 6;
      return stale
        ? { ok: false, reason: "the sweep loop has not completed a pass recently" }
        : { ok: true };
    },
  });

  log.info("keeper started", {
    account: chain.account ?? "(watch-only)",
    pollIntervalMs: keeperConfig.pollIntervalMs,
    stalledAfterBlocks: keeperConfig.stalledAfterBlocks.toString(),
  });

  if (chain.account === null) {
    log.warn("running watch-only: pending graduations will be reported, not finalised", {});
  }

  let running = true;

  const tick = async (): Promise<void> => {
    try {
      const result = await sweep(deps);

      last = result;
      lastSweepAt = Date.now();
      balance = await chain.balance();
      sendable = (await chain.canSend()).ok;

      for (const outcome of result.outcomes) {
        switch (outcome.kind) {
          case "FINALISED":
            log.info("finalised a graduation", { market: outcome.market, hash: outcome.hash });
            break;
          case "ALREADY_DONE":
            // Someone else got there first. The system working, not a fault.
            log.info("already finalised by another caller", { market: outcome.market });
            break;
          case "FAILED":
            log.error("finalise failed; the escrow is unchanged and will be retried", {
              market: outcome.market,
              reason: outcome.reason,
            });
            break;
          case "SKIPPED":
            log.warn("not attempted", { market: outcome.market, reason: outcome.reason });
            break;
        }
      }

      if (result.worstWaitBlocks > keeperConfig.stalledAfterBlocks) {
        log.error("a market has been waiting past the stall threshold", {
          worstWaitBlocks: result.worstWaitBlocks.toString(),
          threshold: keeperConfig.stalledAfterBlocks.toString(),
          pending: result.pending,
        });
      }
    } catch (error) {
      /*
       * The loop must not die. A database outage or an RPC failure is a reason
       * to try again in fifteen seconds, not a reason to stop being the thing
       * that finalises graduations — and a crashed keeper is one whose metrics
       * go away at the moment they are most worth reading.
       */
      log.error("sweep failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const loop = setInterval(() => void tick(), keeperConfig.pollIntervalMs);
  void tick();

  const shutdown = async (): Promise<void> => {
    if (!running) return;
    running = false;

    clearInterval(loop);
    await operations.close();
    await db.close();

    log.info("keeper stopped", {});
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

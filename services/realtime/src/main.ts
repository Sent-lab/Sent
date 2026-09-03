/**
 * SENT — realtime entry point.
 *
 * The gateway needs chain state to report freshness honestly (§87, §211), and it
 * has no chain connection of its own. It reads the indexed height from the
 * projection instead — which is the correct source anyway: the number a client
 * needs is how far behind the DATA is, not how far behind this process is.
 */

import { Database, headBlockIndexed, EventListener } from "@sent/database";
import { chainEnv, databaseEnv, realtimeEnv, loadAll } from "@sent/config/env";
import { createPublicClient, http } from "viem";

import { channelKey, type ServerMessage } from "@sent/realtime";

import { RealtimeServer } from "./server.ts";

async function main(): Promise<void> {
  const { db: dbConfig, chain, realtime } = loadAll({
    db: databaseEnv,
    chain: chainEnv,
    realtime: realtimeEnv,
  });

  const db = new Database(dbConfig);
  const client = createPublicClient({ transport: http(chain.rpcUrl) });

  const server = new RealtimeServer({
    port: realtime.port,
    host: realtime.host,
    replayCapacity: realtime.replayCapacity,
    heartbeatMs: realtime.heartbeatMs,
    flushMs: realtime.flushMs,
  });

  server.start();

  /*
   * Subscribe to the indexer's published events.
   *
   * The indexer NOTIFYs inside the transaction that writes each event, so a
   * message can never arrive here describing rows that were rolled back — and
   * nothing is announced for a block that never committed.
   *
   * This is delivery, not authority (§138). A client that misses messages while
   * this service is down reconnects with `sinceBlock`, and the gateway either
   * replays from its buffer or refuses and marks the session degraded.
   */
  const listener = new EventListener(dbConfig.connectionString, (payload) => {
    const event = payload as { type?: string; market?: string; blockNumber?: string };

    if (typeof event.type !== "string" || typeof event.market !== "string") {
      console.warn("[realtime] ignoring an event with no type or market");
      return;
    }

    server.broadcast({
      // The gateway keys retention on the channel string, so it is built with
      // the shared helper rather than formatted here — two spellings of the same
      // channel would silently deliver to nobody.
      channel: channelKey({ kind: "market", market: event.market.toLowerCase() }),
      // The block travels with the message so a reconnecting client can ask to
      // resume from exactly where it stopped.
      blockNumber: BigInt(event.blockNumber ?? "0"),
      message: payload as ServerMessage,
    });
  });

  await listener.start();

  // Polled rather than pushed. A socket that reported LIVE because this process
  // is up, while the indexer is minutes behind, is the exact lie §211 forbids.
  const refresh = setInterval(() => {
    void (async () => {
      try {
        const [head, indexed] = await Promise.all([
          client.getBlockNumber(),
          headBlockIndexed(db),
        ]);
        server.setChainState(head, indexed, true);
      } catch {
        // Losing the RPC does not mean losing the projection. Reporting
        // RECONNECTING is honest; pretending nothing happened is not.
        server.setChainState(0n, await headBlockIndexed(db).catch(() => 0n), false);
      }
    })();
  }, 2_000);

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[realtime] ${signal} received, closing ${server.connectionCount} connection(s)`);
    clearInterval(refresh);
    await listener.stop();
    await server.stop();
    await db.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.info(`[realtime] listening on ${realtime.host}:${realtime.port}`);
}

main().catch((error: unknown) => {
  console.error(
    `[realtime] failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});

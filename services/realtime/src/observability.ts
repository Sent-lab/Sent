/**
 * SENT — the realtime gateway's metrics (§146, §437).
 *
 * §146 asks for WebSocket health. That is not one number: a gateway can be
 * accepting connections, holding them open, and delivering nothing — which
 * looks identical to a quiet market from the outside, and is the failure this
 * service has already had once.
 *
 * `Gateway.open()` constructs a session rather than returning one, and the
 * flush loop called it per connection every fifty milliseconds, wiping every
 * subscription. Connections were healthy, the process was up, and no subscriber
 * ever received a message. The metric that would have caught it is `delivered`
 * next to `connections` — nonzero sockets and a flat delivery count.
 *
 * DROPPED IS SEPARATE FROM DELIVERED, AND IS THE ALERT
 * ----------------------------------------------------
 * A drop means a client's queue was full: it now has a hole in its view of the
 * chain and has been marked degraded. That is a correctness event, not a
 * capacity statistic, and it is the one worth waking someone for.
 */

import { Registry } from "@sent/observability/metrics";

export const CONNECTIONS = "sent_realtime_connections";
export const CONNECTIONS_TOTAL = "sent_realtime_connections_total";
export const DELIVERED_TOTAL = "sent_realtime_delivered_total";
export const DROPPED_TOTAL = "sent_realtime_dropped_total";
export const BROADCASTS_TOTAL = "sent_realtime_broadcasts_total";
export const DEGRADED_TOTAL = "sent_realtime_degraded_sessions_total";
export const LAG_BLOCKS = "sent_realtime_lag_blocks";
export const CHAIN_CONNECTED = "sent_realtime_chain_connected";

export interface RealtimeMetricSources {
  readonly connections: () => number;
  readonly headBlock: () => bigint;
  readonly indexedBlock: () => bigint;
  readonly chainConnected: () => boolean;
}

export function createRealtimeRegistry(sources: RealtimeMetricSources): Registry {
  const registry = new Registry();

  registry.gauge(CONNECTIONS, "Open WebSocket connections right now.", sources.connections);

  registry.counter(CONNECTIONS_TOTAL, "Connections accepted since start.");
  registry.counter(BROADCASTS_TOTAL, "Events received from the publisher, by type.");

  /*
   * Delivered and dropped, side by side.
   *
   * Together with the connection gauge these answer the question a single
   * "healthy" boolean cannot: connections open and delivery flat is a gateway
   * that is accepting sockets and sending nothing, which is exactly the shape
   * of the subscription-wiping bug this service has already had.
   */
  registry.counter(DELIVERED_TOTAL, "Messages queued to a subscriber.");
  registry.counter(
    DROPPED_TOTAL,
    "Messages a subscriber could not take. Each is a hole in one client's view.",
  );

  registry.counter(
    DEGRADED_TOTAL,
    "Sessions marked degraded, by cause — a dropped message or a reorg beneath them.",
  );

  registry.gauge(LAG_BLOCKS, "Blocks the projection is behind the chain head.", () => {
    const head = sources.headBlock();
    // Null before the first successful head read: zero would say "caught up",
    // which is the flattering reading of "we have never seen the chain".
    if (head === 0n) return null;

    const indexed = sources.indexedBlock();
    return Number(head > indexed ? head - indexed : 0n);
  });

  registry.gauge(CHAIN_CONNECTED, "1 when the RPC is reachable, 0 when it is not.", () =>
    sources.chainConnected() ? 1 : 0,
  );

  return registry;
}

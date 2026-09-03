/**
 * SENT — event fan-out over PostgreSQL LISTEN/NOTIFY.
 *
 * The indexer writes the projection; the realtime service pushes to browsers.
 * §434 keeps them as separate processes, so something has to carry events from
 * one to the other.
 *
 * WHY THE DATABASE AND NOT A MESSAGE BROKER
 * -----------------------------------------
 * NOTIFY is delivered on COMMIT. That single property is why this is the right
 * transport here: an event cannot reach a subscriber unless the rows it
 * describes are already durable. A broker published from inside the ingest
 * transaction would deliver events for a block that then rolled back, and a
 * broker published after the commit would drop them if the process died in
 * between.
 *
 * It also adds no infrastructure. Redis appears in §434's topology as a cache;
 * introducing it here as a bus would be a second thing to run, monitor and lose,
 * for a guarantee the database already provides for free.
 *
 * WHAT IT IS NOT
 * --------------
 * Not durable. A subscriber that is down misses whatever is published while it
 * is down — NOTIFY has no backlog. That is acceptable precisely because this is
 * a DELIVERY mechanism and not a source of truth (§138): a client that missed
 * messages reconnects with `sinceBlock`, and the gateway replays from its buffer
 * or refuses and marks the session degraded.
 *
 * The payload limit is 8000 bytes. Every message here is far smaller, and
 * `publish` refuses rather than letting PostgreSQL truncate one.
 */

import pg from "pg";

import type { Db } from "./repository.ts";

const { Client } = pg;

/** The one channel. Message routing is inside the payload, not in channel names —
    a subscriber that had to LISTEN on a channel per market would need to issue a
    LISTEN for every launch. */
export const EVENT_CHANNEL = "sent_events";

/** PostgreSQL's hard limit on a NOTIFY payload. */
const MAX_PAYLOAD = 8000;

/**
 * Publish an event.
 *
 * Call this INSIDE the transaction that writes the rows it describes. NOTIFY is
 * queued until commit, so a rolled-back block publishes nothing — which is the
 * entire reason for using it.
 */
export async function publish(db: Db, payload: unknown): Promise<void> {
  const body = JSON.stringify(payload, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );

  if (body.length > MAX_PAYLOAD) {
    // Refused rather than truncated. PostgreSQL would reject it anyway, but with
    // an error naming a byte count rather than the event that caused it.
    throw new RangeError(
      `publish: payload is ${body.length} bytes, over the ${MAX_PAYLOAD}-byte NOTIFY limit`,
    );
  }

  // pg_notify rather than the NOTIFY statement: NOTIFY takes a literal, so a
  // payload would have to be interpolated into SQL. This binds it.
  await db.query("SELECT pg_notify($1, $2)", [EVENT_CHANNEL, body]);
}

export type EventHandler = (payload: unknown) => void;

/**
 * Subscribe to published events.
 *
 * Holds its OWN connection rather than borrowing from the pool: a listening
 * connection is occupied for the life of the subscription, and taking one from a
 * pool of ten would quietly remove a tenth of the service's query capacity —
 * or, with a pool of one, all of it.
 */
export class EventListener {
  private client: pg.Client | null = null;
  private readonly connectionString: string;
  private readonly handler: EventHandler;
  private running = false;
  private attempt = 0;

  constructor(connectionString: string, handler: EventHandler) {
    this.connectionString = connectionString;
    this.handler = handler;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;
    const client = this.client;
    this.client = null;
    if (client !== null) await client.end().catch(() => undefined);
  }

  get connected(): boolean {
    return this.client !== null;
  }

  private async connect(): Promise<void> {
    if (!this.running) return;

    const client = new Client({ connectionString: this.connectionString });

    client.on("notification", (message) => {
      if (message.payload === undefined) return;

      let payload: unknown;
      try {
        payload = JSON.parse(message.payload);
      } catch {
        // A malformed payload is a bug in the publisher, not a reason to drop
        // the subscription and lose every subsequent event.
        console.error("[events] ignoring a payload that is not JSON");
        return;
      }

      this.handler(payload);
    });

    client.on("error", (error: Error) => {
      console.error(`[events] connection error: ${error.message}`);
      // `end()` does not fire here reliably, so the reconnect is driven from
      // this handler; guarded by `client === this.client` so a late error from a
      // replaced connection cannot schedule a second one.
      if (this.client === client) {
        this.client = null;
        void this.reconnect();
      }
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${EVENT_CHANNEL}`);

      this.client = client;
      this.attempt = 0;
      console.info(`[events] listening on ${EVENT_CHANNEL}`);
    } catch (error) {
      console.error(
        `[events] could not subscribe: ${error instanceof Error ? error.message : String(error)}`,
      );
      await client.end().catch(() => undefined);
      void this.reconnect();
    }
  }

  private async reconnect(): Promise<void> {
    if (!this.running) return;

    // Capped backoff. Unbounded retry against a database that is down produces a
    // connection storm exactly when it is least able to take one.
    const delay = Math.min(500 * 2 ** Math.min(this.attempt, 5), 15_000);
    this.attempt += 1;

    await new Promise((resolve) => setTimeout(resolve, delay));
    await this.connect();
  }
}

/**
 * SENT — realtime delivery, end to end.
 *
 * The indexer publishes over PostgreSQL NOTIFY; the realtime service listens and
 * pushes to browsers. Both halves had unit coverage and the seam between them
 * had none — which is exactly where this kind of wiring breaks, because every
 * piece works in isolation and nothing connects them.
 *
 * So this runs the real publisher against a real database, the real listener,
 * the real gateway and a real WebSocket, and checks a trade comes out the far
 * end intact.
 *
 * THE ROLLBACK CASE IS THE POINT
 * ------------------------------
 * NOTIFY is delivered on COMMIT. That is the whole reason this transport was
 * chosen over a message broker, and it is a property nothing else in the suite
 * checks: a broker published from inside the ingest transaction would announce
 * trades for a block that then rolled back. The last check here proves the
 * database does not.
 *
 * Skips without DATABASE_URL, like the projection suite.
 */

import { Database, EventListener, publish } from "@sent/database";
import { channelKey, type ServerMessage } from "@sent/realtime";
import { RealtimeServer } from "@sent/realtime-service";
import { WebSocket } from "ws";

const CONNECTION = process.env.DATABASE_URL;

if (CONNECTION === undefined || CONNECTION.trim() === "") {
  console.log("live: DATABASE_URL not set, skipping");
  process.exit(0);
}

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
}

const MARKET = "0x2222222222222222222222222222222222222222";
const PORT = 8199;

/** Long enough for a NOTIFY round trip plus the gateway's flush tick. */
const SETTLE_MS = 600;

const db = new Database({ connectionString: CONNECTION });

const server = new RealtimeServer({
  port: PORT,
  host: "127.0.0.1",
  replayCapacity: 100,
  heartbeatMs: 30_000,
  flushMs: 20,
});

server.start();
server.setChainState(100n, 100n, true);

const listener = new EventListener(CONNECTION, (payload) => {
  const event = payload as { market: string; blockNumber: string };

  server.broadcast({
    channel: channelKey({ kind: "market", market: event.market.toLowerCase() }),
    blockNumber: BigInt(event.blockNumber ?? "0"),
    message: payload as ServerMessage,
  });
});

await listener.start();
check("the listener subscribed", listener.connected);

const received: ServerMessage[] = [];
const socket = new WebSocket(`ws://127.0.0.1:${PORT}`);

// Attached BEFORE waiting for the open. The server sends `hello` from inside
// its connection handler, so a listener registered after the open event has
// already missed it.
socket.on("message", (data) => received.push(JSON.parse(String(data)) as ServerMessage));

await new Promise<void>((resolve) => socket.on("open", () => resolve()));

socket.send(
  JSON.stringify({
    type: "subscribe",
    channels: [{ kind: "market", market: MARKET }],
  }),
);

await new Promise((resolve) => setTimeout(resolve, 300));

// Published inside a transaction, exactly as the indexer does it.
await db.transaction(async (tx) => {
  await publish(tx, {
    type: "trade",
    market: MARKET,
    side: "BUY",
    trader: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    txHash: "0xdead",
    blockNumber: 42n,
    notional: 1_000n,
    tokens: 5n,
    coreFee: 10n,
    creatorFee: 7n,
    platformFee: 3n,
    stockback: 5n,
    priceAfter: 123n,
    distributedAfter: 5n,
    timestamp: 1_700_000_000,
  });
});

await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

const trade = received.find((m) => m.type === "trade") as Record<string, unknown> | undefined;

check("a hello arrived on connect", received.some((m) => m.type === "hello"));
check("the trade came through the socket", trade !== undefined);
check("with its market intact", trade?.market === MARKET);

// §316: the split must survive the whole path. Aggregating it anywhere between
// the chain and the tape would hide which part funds the creator.
check("the fee split survived, unaggregated", trade?.creatorFee === "7" && trade?.platformFee === "3");

// §424: a quantity that became a JSON number somewhere along this path would be
// a lossy double for any real market size.
check("quantities crossed as strings", typeof trade?.notional === "string");
check("and so did the block height", trade?.blockNumber === "42");

// The property the whole transport choice rests on.
const before = received.length;

await db
  .transaction(async (tx) => {
    await publish(tx, { type: "trade", market: MARKET, blockNumber: 99n });
    throw new Error("deliberate rollback");
  })
  .catch(() => undefined);

await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

check("a rolled-back transaction publishes nothing", received.length === before);

// A payload over the NOTIFY limit is refused rather than truncated.
let refused = false;
try {
  await publish(db, { type: "trade", market: MARKET, junk: "x".repeat(9_000) });
} catch (error) {
  refused = error instanceof RangeError;
}
check("an oversized payload is refused", refused);

socket.close();
await listener.stop();
await server.stop();
await db.close();

console.log(failures === 0 ? "\nlive: all checks passed" : `\nlive: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

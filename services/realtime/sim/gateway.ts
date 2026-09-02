/**
 * SENT — realtime gateway audit.
 *
 * §63 requires session resilience; §239 requires honest connection-loss UX.
 *
 * The failure worth testing is not a dropped socket — that is visible and users
 * forgive it. It is a socket that drops, reconnects, and resumes from "now": the
 * client looks perfectly healthy while silently missing every trade in the gap.
 * The chart has a hole, the balance is stale, and nothing indicates it.
 *
 * Run: pnpm sim:gateway
 */

import {
  Gateway,
  ReplayBuffer,
  Session,
  buildFreshness,
  type RetainedMessage,
} from "../src/gateway.ts";
import { channelKey, type ServerMessage, type TradeMessage } from "../../../packages/realtime/src/schema.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const MARKET = "0xmarket";
const CH = channelKey({ kind: "market", market: MARKET });

function trade(block: number): RetainedMessage {
  const message: TradeMessage = {
    type: "trade",
    market: MARKET,
    side: "BUY",
    trader: "0xtrader",
    txHash: `0xtx${block}`,
    blockNumber: String(block),
    notional: "1000",
    tokens: "500",
    coreFee: "10",
    creatorFee: "7",
    platformFee: "3",
    stockback: "10",
    priceAfter: "42",
    distributedAfter: "500",
    timestamp: block,
  };
  return { blockNumber: BigInt(block), channel: CH, message };
}

const freshness = buildFreshness(100n, 100n, true);

console.log("\nSENT — Realtime Gateway Audit (§63, §239, §83)");
console.log("=".repeat(74));

// ---------------------------------------------------------------------------
console.log("\n--- 1. Subscription basics --------------------------------------------");

{
  const gw = new Gateway();
  const s = gw.open("s1");

  const out = s.handle(
    { type: "subscribe", channels: [{ kind: "market", market: MARKET }] },
    gw.buffer,
    freshness,
  );

  check("subscribing succeeds", out.kind === "send");
  check("the channel is registered", s.subscriptions.has(CH));

  gw.broadcast(trade(101));
  check("a broadcast reaches a subscriber", s.drain().length === 1);
}

{
  const gw = new Gateway();
  const s = gw.open("s1");
  const out = s.handle({ type: "subscribe", channels: [] }, gw.buffer, freshness);

  check(
    "an empty subscription is rejected explicitly",
    out.kind === "send" && out.messages[0]?.type === "error",
  );
}

{
  const gw = new Gateway();
  const a = gw.open("a");
  const b = gw.open("b");

  a.handle({ type: "subscribe", channels: [{ kind: "market", market: MARKET }] }, gw.buffer, freshness);
  b.handle({ type: "subscribe", channels: [{ kind: "market", market: "0xother" }] }, gw.buffer, freshness);

  const result = gw.broadcast(trade(101));

  check("only subscribers receive a broadcast", result.delivered === 1);
  check("a non-subscriber's queue stays empty", b.drain().length === 0);
}

// ---------------------------------------------------------------------------
console.log("\n--- 2. THE reconnect gap ------------------------------------------------");

{
  // The scenario: a client is at block 100, drops, twenty trades happen, it
  // reconnects. Resuming from "now" would leave a silent hole.
  const gw = new Gateway();
  const s = gw.open("s1");
  s.handle({ type: "subscribe", channels: [{ kind: "market", market: MARKET }] }, gw.buffer, freshness);

  for (let b = 101; b <= 120; b++) gw.broadcast(trade(b));

  // Reconnect, declaring what it already has.
  const reconnected = gw.open("s2");
  const out = reconnected.handle(
    {
      type: "subscribe",
      channels: [{ kind: "market", market: MARKET }],
      sinceBlock: "100",
    },
    gw.buffer,
    freshness,
  );

  const replayed =
    out.kind === "send" ? out.messages.filter((m) => m.type === "trade") : [];

  check("the gap is replayed rather than skipped", replayed.length === 20);
  check(
    "replay starts at the first missed block",
    (replayed[0] as TradeMessage | undefined)?.blockNumber === "101",
  );
  check(
    "replay ends at the latest block",
    (replayed[replayed.length - 1] as TradeMessage | undefined)?.blockNumber === "120",
  );
  check(
    "a freshness envelope accompanies the replay",
    out.kind === "send" && out.messages.some((m) => m.type === "freshness"),
  );
}

{
  // A client asking from before the buffer's window cannot be caught up. Handing
  // it a partial replay would leave it believing it is complete.
  const gw = new Gateway(new ReplayBuffer(10));
  const s = gw.open("s1");
  s.handle({ type: "subscribe", channels: [{ kind: "market", market: MARKET }] }, gw.buffer, freshness);

  for (let b = 101; b <= 200; b++) gw.broadcast(trade(b));

  const out = s.handle(
    { type: "subscribe", channels: [{ kind: "market", market: MARKET }], sinceBlock: "100" },
    gw.buffer,
    freshness,
  );

  const err = out.kind === "send" ? out.messages.find((m) => m.type === "error") : undefined;

  check("a gap beyond the retained window is refused", err !== undefined);
  check(
    "the refusal names the reason rather than failing silently",
    err !== undefined && (err as { code: string }).code === "REPLAY_WINDOW_EXCEEDED",
  );
  check(
    "no partial replay is delivered alongside the refusal",
    out.kind === "send" && !out.messages.some((m) => m.type === "trade"),
  );
}

{
  // A client already up to date asks for a replay: nothing to send, no error.
  const gw = new Gateway();
  const s = gw.open("s1");
  s.handle({ type: "subscribe", channels: [{ kind: "market", market: MARKET }] }, gw.buffer, freshness);
  gw.broadcast(trade(101));
  s.drain();

  const out = s.handle(
    { type: "subscribe", channels: [{ kind: "market", market: MARKET }], sinceBlock: "101" },
    gw.buffer,
    freshness,
  );

  check(
    "an up-to-date client gets no replay and no error",
    out.kind === "send" && !out.messages.some((m) => m.type === "trade" || m.type === "error"),
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- 3. Backpressure must be visible, not silent ------------------------");

{
  const gw = new Gateway();
  const s = gw.open("slow", { maxQueue: 5, maxReplayBlocks: 512 });
  s.handle({ type: "subscribe", channels: [{ kind: "market", market: MARKET }] }, gw.buffer, freshness);

  let dropped = 0;
  for (let b = 101; b <= 120; b++) dropped += gw.broadcast(trade(b)).dropped;

  check("a slow client's queue is bounded", s.drain().length === 5);
  check("overflow is counted, not ignored", dropped > 0);
  check("the session is marked degraded", s.degraded);

  const notice = s.degradedNotice();
  check("a degraded client is told, not left guessing", notice !== null);
  check(
    "the notice instructs a resnapshot rather than a retry",
    notice !== null && (notice as { code: string }).code === "MESSAGES_DROPPED",
  );
}

{
  // A healthy client must never be marked degraded by a neighbour's slowness.
  const gw = new Gateway();
  const slow = gw.open("slow", { maxQueue: 2, maxReplayBlocks: 512 });
  const fast = gw.open("fast");

  for (const s of [slow, fast]) {
    s.handle({ type: "subscribe", channels: [{ kind: "market", market: MARKET }] }, gw.buffer, freshness);
  }

  for (let b = 101; b <= 110; b++) {
    gw.broadcast(trade(b));
    fast.drain(); // the fast client keeps up
  }

  check("a slow client degrades", slow.degraded);
  check("a fast client is unaffected by its neighbour", !fast.degraded);
}

// ---------------------------------------------------------------------------
console.log("\n--- 4. A reorg invalidates what clients already saw ---------------------");

{
  const gw = new Gateway();
  const s = gw.open("s1");
  s.handle({ type: "subscribe", channels: [{ kind: "market", market: MARKET }] }, gw.buffer, freshness);

  for (let b = 101; b <= 110; b++) gw.broadcast(trade(b));
  s.drain();

  // The chain rolls back to 105. Everything the client saw above that describes
  // a chain that no longer exists.
  const affected = gw.handleReorg(105n);

  check("clients that saw rolled-back blocks are marked degraded", affected === 1);
  check("the affected session knows it is degraded", s.degraded);

  check(
    "retained messages above the fork are discarded",
    gw.buffer.since(0n, new Set([CH])).every((m) => m.blockNumber <= 105n),
  );

  // A client reconnecting after the reorg must not be replayed the void blocks.
  const fresh = gw.open("s2");
  const out = fresh.handle(
    { type: "subscribe", channels: [{ kind: "market", market: MARKET }], sinceBlock: "100" },
    gw.buffer,
    freshness,
  );
  const replayed = out.kind === "send" ? out.messages.filter((m) => m.type === "trade") : [];

  check("replay after a reorg contains only surviving blocks", replayed.length === 5);
  check(
    "and stops at the fork point",
    (replayed[replayed.length - 1] as TradeMessage | undefined)?.blockNumber === "105",
  );
}

{
  // A client that never received the rolled-back blocks must not be punished.
  const gw = new Gateway();
  const behind = gw.open("behind");
  behind.handle({ type: "subscribe", channels: [{ kind: "market", market: MARKET }] }, gw.buffer, freshness);

  gw.broadcast(trade(101));
  behind.drain();

  gw.handleReorg(105n);
  check("a client below the fork is not marked degraded", !behind.degraded);
}

// ---------------------------------------------------------------------------
console.log("\n--- 5. Unsubscribe and lifecycle ---------------------------------------");

{
  const gw = new Gateway();
  const s = gw.open("s1");
  s.handle({ type: "subscribe", channels: [{ kind: "market", market: MARKET }] }, gw.buffer, freshness);
  s.handle({ type: "unsubscribe", channels: [{ kind: "market", market: MARKET }] }, gw.buffer, freshness);

  gw.broadcast(trade(101));
  check("an unsubscribed session receives nothing", s.drain().length === 0);

  gw.close("s1");
  check("a closed session is removed", gw.sessionCount === 0);
}

{
  const gw = new Gateway();
  const s = gw.open("s1");
  const out = s.handle({ type: "ping", nonce: 1 }, gw.buffer, freshness);

  check(
    "a ping is answered with current freshness, not a bare pong",
    out.kind === "send" && out.messages[0]?.type === "freshness",
  );
}

// ---------------------------------------------------------------------------
console.log("\n--- 6. Freshness envelope ------------------------------------------------");

{
  check("a caught-up gateway reports LIVE", buildFreshness(100n, 100n, true).state === "LIVE");
  check("a lagging gateway does not report LIVE", buildFreshness(200n, 100n, true).state !== "LIVE");
  check(
    "a disconnected gateway reports RECONNECTING however small the lag",
    buildFreshness(100n, 100n, false).state === "RECONNECTING",
  );
  check("lag is reported numerically", buildFreshness(150n, 100n, true).lagBlocks === 50);
  check(
    "the finalized boundary is carried when known",
    buildFreshness(150n, 100n, true, 130n).finalizedBlock === "130",
  );
}

// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(74));
if (failures.length === 0) {
  console.log(`GATEWAY AUDIT: PASS — ${passed} checks green.`);
  console.log("");
  console.log("A reconnect either replays the gap or says it cannot. It never resumes");
  console.log("from 'now', because a client that looks healthy while missing trades is");
  console.log("worse than one that knows it is behind.");
} else {
  console.log(`GATEWAY AUDIT: FAIL — ${failures.length} of ${passed + failures.length} failed.`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
console.log("");

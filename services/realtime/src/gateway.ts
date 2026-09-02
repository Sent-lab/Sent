/**
 * SENT — realtime gateway logic.
 *
 * Subscription management, reconnect replay and backpressure, as a pure state
 * machine over messages. No sockets, no timers, no I/O — so the cases that
 * matter can actually be tested, instead of being hoped about.
 *
 * WHY REPLAY IS THE HARD PART (§63, §239)
 * ----------------------------------------
 * §63 requires session resilience and §239 requires honest connection-loss UX.
 * The failure mode is not a dropped socket — that is visible and users forgive
 * it. It is a socket that drops, reconnects, and resumes from "now": the client
 * looks perfectly healthy while silently missing every trade that happened in
 * the gap. The chart has a hole, the balance is wrong, and nothing indicates it.
 *
 * So a reconnect always carries `sinceBlock`, and the gateway either replays the
 * gap or tells the client the gap is too large and it must resnapshot. It never
 * simply resumes.
 *
 * BACKPRESSURE IS A CORRECTNESS PROBLEM (§83)
 * -------------------------------------------
 * A slow client cannot be allowed to grow an unbounded queue in a service that
 * other clients depend on. But silently dropping messages recreates the hole
 * replay exists to prevent. So an overflowing client is marked as needing a
 * resnapshot and told so — degraded, and aware of it.
 */

import {
  channelKey,
  classifyFreshness,
  type Channel,
  type ClientMessage,
  type ServerMessage,
  type FreshnessEnvelope,
} from "@sent/realtime";

export interface SessionOptions {
  /** Messages buffered for a slow client before it is told to resnapshot. */
  readonly maxQueue: number;
  /** Blocks of history the gateway will replay. Beyond this, resnapshot. */
  readonly maxReplayBlocks: number;
}

export const DEFAULT_SESSION_OPTIONS: SessionOptions = {
  maxQueue: 512,
  maxReplayBlocks: 512,
};

export type SessionOutcome =
  | { readonly kind: "send"; readonly messages: readonly ServerMessage[] }
  | { readonly kind: "close"; readonly code: string; readonly reason: string };

/** A retained message, so a reconnecting client can be caught up. */
export interface RetainedMessage {
  readonly blockNumber: bigint;
  readonly channel: string;
  readonly message: ServerMessage;
}

/**
 * Bounded ring of recent messages, shared across sessions.
 *
 * The bound is what makes a resnapshot decision honest: the gateway knows
 * exactly how far back it can vouch for, and says so rather than replaying a
 * partial gap and calling it complete.
 */
export class ReplayBuffer {
  private readonly items: RetainedMessage[] = [];
  private readonly capacity: number;

  constructor(capacity = 8192) {
    if (capacity < 1) throw new RangeError("ReplayBuffer: capacity must be positive");
    this.capacity = capacity;
  }

  append(item: RetainedMessage): void {
    this.items.push(item);
    while (this.items.length > this.capacity) this.items.shift();
  }

  get earliestBlock(): bigint | undefined {
    return this.items[0]?.blockNumber;
  }

  get size(): number {
    return this.items.length;
  }

  /** Everything after `sinceBlock` on the given channels, in arrival order. */
  since(sinceBlock: bigint, channels: ReadonlySet<string>): RetainedMessage[] {
    return this.items.filter(
      (item) => item.blockNumber > sinceBlock && channels.has(item.channel),
    );
  }

  /**
   * Whether the gap can be replayed in full.
   *
   * A client asking from before the buffer's earliest retained block cannot be
   * caught up, and must be told to resnapshot rather than handed a partial
   * replay that looks complete.
   */
  canReplayFrom(sinceBlock: bigint): boolean {
    const earliest = this.earliestBlock;
    if (earliest === undefined) return true;
    return sinceBlock + 1n >= earliest;
  }

  /** Rewind after a chain reorg: retained messages above the fork are void. */
  rollbackTo(blockNumber: bigint): void {
    const index = this.items.findIndex((item) => item.blockNumber > blockNumber);
    if (index !== -1) this.items.splice(index);
  }
}

export interface SessionState {
  readonly id: string;
  readonly channels: Set<string>;
  /** Queued outbound messages. Bounded by `maxQueue`. */
  readonly queue: ServerMessage[];
  /** True once the queue overflowed. The client must resnapshot before trusting. */
  degraded: boolean;
  lastDeliveredBlock: bigint;
}

export class Session {
  readonly state: SessionState;
  private readonly options: SessionOptions;

  constructor(id: string, options: SessionOptions = DEFAULT_SESSION_OPTIONS) {
    this.options = options;
    this.state = {
      id,
      channels: new Set(),
      queue: [],
      degraded: false,
      lastDeliveredBlock: 0n,
    };
  }

  get degraded(): boolean {
    return this.state.degraded;
  }

  get subscriptions(): ReadonlySet<string> {
    return this.state.channels;
  }

  /**
   * Handle a client message.
   *
   * Every path returns what the server should send. Nothing is implicit: a
   * subscribe with a `sinceBlock` the gateway cannot honour produces an explicit
   * resnapshot instruction, not silence.
   */
  handle(
    message: ClientMessage,
    buffer: ReplayBuffer,
    freshness: FreshnessEnvelope,
  ): SessionOutcome {
    switch (message.type) {
      case "subscribe":
        return this.subscribe(message.channels, message.sinceBlock, buffer, freshness);

      case "unsubscribe": {
        for (const channel of message.channels) this.state.channels.delete(channelKey(channel));
        return { kind: "send", messages: [] };
      }

      case "ping":
        return { kind: "send", messages: [{ type: "freshness", freshness }] };
    }
  }

  private subscribe(
    channels: readonly Channel[],
    sinceBlock: bigint | string | undefined,
    buffer: ReplayBuffer,
    freshness: FreshnessEnvelope,
  ): SessionOutcome {
    if (channels.length === 0) {
      return {
        kind: "send",
        messages: [
          {
            type: "error",
            code: "EMPTY_SUBSCRIPTION",
            message: "subscribe requires at least one channel",
            retryable: false,
          },
        ],
      };
    }

    for (const channel of channels) this.state.channels.add(channelKey(channel));

    if (sinceBlock === undefined) {
      // A fresh session: the client will fetch a snapshot over HTTP, so there is
      // no gap to fill.
      return { kind: "send", messages: [] };
    }

    const since = typeof sinceBlock === "string" ? BigInt(sinceBlock) : sinceBlock;

    if (!buffer.canReplayFrom(since)) {
      // The honest answer. Handing over a partial replay would leave the client
      // believing it is complete, which is the exact hole §239 is about.
      return {
        kind: "send",
        messages: [
          {
            type: "error",
            code: "REPLAY_WINDOW_EXCEEDED",
            message:
              `cannot replay from block ${since}; earliest retained is ` +
              `${buffer.earliestBlock ?? "none"}. Fetch a fresh snapshot.`,
            retryable: false,
          },
          { type: "freshness", freshness },
        ],
      };
    }

    const replayed = buffer.since(since, this.state.channels).map((item) => item.message);

    if (replayed.length > this.options.maxQueue) {
      return {
        kind: "send",
        messages: [
          {
            type: "error",
            code: "REPLAY_TOO_LARGE",
            message: `${replayed.length} messages to replay exceeds the session limit; resnapshot instead`,
            retryable: false,
          },
        ],
      };
    }

    this.state.lastDeliveredBlock = since;
    return { kind: "send", messages: [...replayed, { type: "freshness", freshness }] };
  }

  /**
   * Enqueue a broadcast for this session.
   *
   * Returns false when the message was dropped because the queue is full. The
   * session is marked degraded at that moment, so the client can be told rather
   * than left believing it has seen everything.
   */
  enqueue(item: RetainedMessage): boolean {
    if (!this.state.channels.has(item.channel)) return false;

    if (this.state.queue.length >= this.options.maxQueue) {
      this.state.degraded = true;
      return false;
    }

    this.state.queue.push(item.message);
    this.state.lastDeliveredBlock = item.blockNumber;
    return true;
  }

  /** Take everything queued. */
  drain(): ServerMessage[] {
    const out = [...this.state.queue];
    this.state.queue.length = 0;
    return out;
  }

  /**
   * Message telling a degraded client what happened.
   *
   * Silence after an overflow is the failure §239 forbids: the client looks
   * connected and healthy while missing data.
   */
  degradedNotice(): ServerMessage | null {
    if (!this.state.degraded) return null;
    return {
      type: "error",
      code: "MESSAGES_DROPPED",
      message: "this session fell behind and dropped messages; fetch a fresh snapshot",
      retryable: false,
    };
  }

  clearDegraded(): void {
    this.state.degraded = false;
  }
}

/**
 * Fan-out across sessions.
 *
 * Deliberately synchronous and pure: a broadcast either reaches a session's queue
 * or is recorded as dropped. There is no partial success that goes unnoticed.
 */
export class Gateway {
  private readonly sessions = new Map<string, Session>();
  readonly buffer: ReplayBuffer;

  constructor(buffer: ReplayBuffer = new ReplayBuffer()) {
    this.buffer = buffer;
  }

  open(id: string, options?: SessionOptions): Session {
    const session = new Session(id, options);
    this.sessions.set(id, session);
    return session;
  }

  close(id: string): void {
    this.sessions.delete(id);
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Publish to every subscriber, and retain for replay. */
  broadcast(item: RetainedMessage): { delivered: number; dropped: number } {
    this.buffer.append(item);

    let delivered = 0;
    let dropped = 0;

    for (const session of this.sessions.values()) {
      if (!session.subscriptions.has(item.channel)) continue;
      if (session.enqueue(item)) delivered += 1;
      else dropped += 1;
    }

    return { delivered, dropped };
  }

  /**
   * A chain reorg invalidates retained messages above the fork.
   *
   * Every session is marked degraded, because messages they already received may
   * describe a chain that no longer exists. Letting them keep that state would
   * leave the UI showing trades that were rolled back.
   */
  handleReorg(rollbackTo: bigint): number {
    this.buffer.rollbackTo(rollbackTo);

    let affected = 0;
    for (const session of this.sessions.values()) {
      if (session.state.lastDeliveredBlock > rollbackTo) {
        session.state.degraded = true;
        affected += 1;
      }
    }
    return affected;
  }
}

/**
 * Build the envelope every message set carries.
 *
 * `serverTime` is a required argument rather than a zero default. A zero would
 * claim 1970, and a client rendering "updated Xs ago" would show 56 years — a
 * silent lie in the field built to prevent exactly that (§279).
 */
export function buildFreshness(
  headBlock: bigint,
  indexedBlock: bigint,
  connected: boolean,
  serverTime: number,
  finalizedBlock?: bigint,
): FreshnessEnvelope {
  const lag = headBlock > indexedBlock ? Number(headBlock - indexedBlock) : 0;

  return {
    state: classifyFreshness(lag, connected),
    headBlock: headBlock.toString(),
    lagBlocks: lag,
    ...(finalizedBlock !== undefined ? { finalizedBlock: finalizedBlock.toString() } : {}),
    serverTime,
  };
}

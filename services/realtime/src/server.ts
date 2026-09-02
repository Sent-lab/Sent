/**
 * SENT — WebSocket transport.
 *
 * The gateway is a pure state machine and stays that way: subscriptions, replay
 * and backpressure were all decided and tested without a socket. This file is the
 * socket, and it holds no policy of its own.
 *
 * That split is deliberate. The behaviour that matters — a reconnect either
 * replaying the gap or refusing, a slow client degrading visibly — is exactly the
 * behaviour that is miserable to test through a real connection.
 *
 * §419 puts the realtime service alongside the API rather than inside the
 * frontend deployment, because a socket that dies with a page render is not a
 * realtime service.
 */

import { WebSocketServer, WebSocket } from "ws";

import {
  Gateway,
  ReplayBuffer,
  buildFreshness,
  type RetainedMessage,
} from "./gateway.ts";
import type { ClientMessage, ServerMessage } from "@sent/realtime";

export interface RealtimeConfig {
  readonly port: number;
  readonly host: string;
  /** Messages retained for reconnect replay across all channels. */
  readonly replayCapacity: number;
  /** Silence after which a connection is assumed dead, in ms. */
  readonly heartbeatMs: number;
  /** Outbound flush cadence, in ms. */
  readonly flushMs: number;
}

export const DEFAULT_REALTIME_CONFIG: RealtimeConfig = {
  port: 8081,
  host: "0.0.0.0",
  replayCapacity: 8_192,
  heartbeatMs: 30_000,
  flushMs: 50,
};

interface Connection {
  readonly socket: WebSocket;
  readonly id: string;
  alive: boolean;
}

export class RealtimeServer {
  private readonly wss: WebSocketServer;
  private readonly gateway: Gateway;
  private readonly connections = new Map<string, Connection>();
  private readonly config: RealtimeConfig;

  private headBlock = 0n;
  private indexedBlock = 0n;
  private chainConnected = false;
  private nextId = 1;

  private flushTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;

  constructor(config: RealtimeConfig = DEFAULT_REALTIME_CONFIG) {
    this.config = config;
    this.gateway = new Gateway(new ReplayBuffer(config.replayCapacity));
    this.wss = new WebSocketServer({ port: config.port, host: config.host });

    this.wss.on("connection", (socket) => this.onConnection(socket));
  }

  /** Called by the indexer as it advances, so freshness reflects reality. */
  setChainState(head: bigint, indexed: bigint, connected: boolean): void {
    this.headBlock = head;
    this.indexedBlock = indexed;
    this.chainConnected = connected;
  }

  /** Publish an event to every subscriber and retain it for replay. */
  broadcast(item: RetainedMessage): void {
    const { dropped } = this.gateway.broadcast(item);
    if (dropped > 0) {
      // Not silent. A dropped message is a hole in a client's view, and the
      // sessions that took it are already marked degraded — this makes the
      // operator aware too.
      console.warn(`[realtime] dropped ${dropped} message(s) to slow clients`);
    }
  }

  /**
   * A chain reorg voids retained messages above the fork.
   *
   * Every session that saw a rolled-back block is marked degraded, because
   * messages they already hold describe a chain that no longer exists.
   */
  handleReorg(rollbackTo: bigint): void {
    const affected = this.gateway.handleReorg(rollbackTo);
    if (affected > 0) console.warn(`[realtime] reorg to ${rollbackTo}: ${affected} session(s) degraded`);
  }

  start(): void {
    this.flushTimer = setInterval(() => this.flushAll(), this.config.flushMs);

    // A socket that stops responding still consumes a slot and still looks
    // subscribed. Ping/pong is what distinguishes a quiet client from a dead one.
    this.heartbeatTimer = setInterval(() => this.sweepDead(), this.config.heartbeatMs);
  }

  async stop(): Promise<void> {
    if (this.flushTimer !== undefined) clearInterval(this.flushTimer);
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);

    for (const connection of this.connections.values()) connection.socket.close();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  // -------------------------------------------------------------------------

  private onConnection(socket: WebSocket): void {
    const id = `s${this.nextId++}`;
    const session = this.gateway.open(id);
    this.connections.set(id, { socket, id, alive: true });

    socket.on("pong", () => {
      const connection = this.connections.get(id);
      if (connection !== undefined) connection.alive = true;
    });

    this.send(socket, {
      type: "hello",
      sessionId: id,
      chainId: 999,
      freshness: this.freshness(),
      protocol: 1,
    });

    socket.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        // Malformed input is named rather than ignored: a client sending
        // garbage and receiving silence has no way to learn it is broken.
        this.send(socket, {
          type: "error",
          code: "MALFORMED_MESSAGE",
          message: "expected JSON",
          retryable: false,
        });
        return;
      }

      const outcome = session.handle(message, this.gateway.buffer, this.freshness());

      if (outcome.kind === "close") {
        this.send(socket, {
          type: "error",
          code: outcome.code,
          message: outcome.reason,
          retryable: false,
        });
        socket.close();
        return;
      }

      for (const out of outcome.messages) this.send(socket, out);
    });

    socket.on("close", () => {
      this.gateway.close(id);
      this.connections.delete(id);
    });

    socket.on("error", () => {
      this.gateway.close(id);
      this.connections.delete(id);
    });
  }

  /** Flush queued messages, and tell degraded sessions they are degraded. */
  private flushAll(): void {
    for (const connection of this.connections.values()) {
      if (connection.socket.readyState !== WebSocket.OPEN) continue;

      const session = this.gateway.open(connection.id);
      const notice = session.degradedNotice();

      if (notice !== null) {
        this.send(connection.socket, notice);
        session.clearDegraded();
      }

      for (const message of session.drain()) this.send(connection.socket, message);
    }
  }

  private sweepDead(): void {
    for (const connection of this.connections.values()) {
      if (!connection.alive) {
        connection.socket.terminate();
        this.gateway.close(connection.id);
        this.connections.delete(connection.id);
        continue;
      }

      connection.alive = false;
      connection.socket.ping();
    }
  }

  private freshness() {
    return buildFreshness(
      this.headBlock,
      this.indexedBlock,
      this.chainConnected,
      Math.floor(Date.now() / 1000),
    );
  }

  /**
   * Send one message.
   *
   * BigInt is serialised as a string for the same reason the HTTP API does it:
   * `JSON.stringify` throws on it, and converting through `Number()` loses
   * precision silently above 2^53.
   */
  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;

    socket.send(
      JSON.stringify(message, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    );
  }
}

"use client";

/**
 * SENT — realtime client (§22).
 *
 * §22 makes real-time mandatory: every trade updates price, chart, candle,
 * volume, the tape, graduation progress and holder metrics without a manual
 * refresh.
 *
 * RECONNECTING REPLAYS THE GAP, IT DOES NOT RESUME (§63, §239)
 * ------------------------------------------------------------
 * A socket that drops and simply resubscribes leaves a hole: everything that
 * happened while it was down is missing, and nothing on screen says so. The
 * protocol's `sinceBlock` exists for this — the client sends the last block it
 * actually received, and the server replays from there or refuses.
 *
 * When the server cannot replay (the gap is older than its buffer), the session
 * is marked degraded and the UI is told. §211's whole point is that a view which
 * is missing data says so rather than looking complete.
 *
 * THE SOCKET IS NOT THE AUTHORITY
 * -------------------------------
 * §138: the chain is. This stream is a delivery mechanism for what the indexer
 * already wrote, and a client that treated a socket message as truth would be
 * building state the projection could later disagree with. Every message here
 * carries the block it came from, so a consumer can tell.
 */

import { useEffect, useRef, useState } from "react";

import type {
  Channel,
  ClientMessage,
  ServerMessage,
  FreshnessEnvelope,
} from "@sent/realtime";

export const REALTIME_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:8081";

export type ConnectionState = "connecting" | "open" | "closed" | "degraded";

export interface LiveState {
  readonly connection: ConnectionState;
  /** Latest envelope the server sent, or null before the first one. */
  readonly freshness: FreshnessEnvelope | null;
  /** Messages received since mount, newest first, capped. */
  readonly messages: readonly ServerMessage[];
}

/** Retained messages. Enough for a visible tape, bounded so a long session
    cannot grow without limit. */
const MAX_MESSAGES = 200;

/** Reconnect backoff, in ms. Capped so a long outage does not become a long
    silence after it ends. */
const BACKOFF = [500, 1_000, 2_000, 5_000, 10_000] as const;

/**
 * Subscribe to a set of channels.
 *
 * Returns the connection state, the latest freshness envelope, and the messages
 * received. Deliberately does not maintain derived market state: a component
 * that needs a price applies the messages to what the server already rendered,
 * so the socket can only ever move state forward from a known point.
 */
export function useLive(channels: readonly Channel[]): LiveState {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [freshness, setFreshness] = useState<FreshnessEnvelope | null>(null);
  const [messages, setMessages] = useState<readonly ServerMessage[]>([]);

  // The last block actually received. Kept in a ref rather than state: it must
  // survive a reconnect without re-running the effect that does the reconnecting.
  const lastBlock = useRef<string | null>(null);
  const attempt = useRef(0);

  // Serialised, so a caller passing a fresh array literal every render does not
  // tear down and rebuild the socket on every render.
  const key = JSON.stringify(channels);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = (): void => {
      if (disposed) return;

      setConnection((current) => (current === "degraded" ? "degraded" : "connecting"));

      socket = new WebSocket(REALTIME_URL);

      socket.onopen = () => {
        if (disposed) return;
        attempt.current = 0;
        setConnection("open");

        const subscribe: ClientMessage = {
          type: "subscribe",
          channels: JSON.parse(key) as Channel[],
          // Replay from where this client actually got to. Omitted on a first
          // connection, where there is no gap to fill.
          ...(lastBlock.current !== null ? { sinceBlock: lastBlock.current } : {}),
        };

        socket?.send(JSON.stringify(subscribe));
      };

      socket.onmessage = (event) => {
        if (disposed) return;

        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          // A malformed frame is the server's bug, not a reason to tear down a
          // working connection. Dropped, and the next frame is still handled.
          return;
        }

        if (message.type === "hello" || message.type === "freshness") {
          setFreshness(message.freshness);
        }

        // Any message carrying a block advances the resume point. This is what
        // makes the next reconnect able to ask for the right gap.
        const block = (message as { blockNumber?: string }).blockNumber;
        if (typeof block === "string") lastBlock.current = block;

        if (message.type === "error") {
          // The server refused to replay, so this session has a hole in it. The
          // UI must say so; silently carrying on is the misleading state §211
          // exists to prevent.
          setConnection("degraded");
          return;
        }

        setMessages((current) => [message, ...current].slice(0, MAX_MESSAGES));
      };

      socket.onclose = () => {
        if (disposed) return;
        setConnection((current) => (current === "degraded" ? "degraded" : "closed"));

        const delay = BACKOFF[Math.min(attempt.current, BACKOFF.length - 1)] ?? 10_000;
        attempt.current += 1;
        timer = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        // `onclose` always follows, and handles the retry. Doing it here too
        // would schedule two reconnects for one failure.
        socket?.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      // Closed without a code so the server sees a normal close rather than an
      // abort, and does not log every page navigation as a fault.
      socket?.close();
    };
  }, [key]);

  return { connection, freshness, messages };
}

/** Channel for one market's trades and state (§79 channel shape). */
export function marketChannel(market: string): Channel {
  return { kind: "market", market: market.toLowerCase() };
}

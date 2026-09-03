"use client";

/**
 * SENT — live trade tape (§22).
 *
 * §22 requires recent trades to update without a manual refresh. This takes the
 * rows the server already rendered and prepends what arrives on the socket.
 *
 * THE SOCKET MOVES STATE FORWARD; IT NEVER REPLACES IT
 * ----------------------------------------------------
 * The initial rows come from the API, which reads the projection, which is built
 * from the chain (§138). A live message is the same data arriving sooner. So
 * messages are merged onto the server rows rather than becoming a separate
 * source — and merging is keyed on the transaction, so a trade that arrives on
 * the socket and then again in a later fetch appears once.
 *
 * A DEGRADED SOCKET SAYS SO
 * -------------------------
 * If the connection drops and the server cannot replay the gap, the tape is
 * missing trades. §211 does not allow that to look identical to a quiet market,
 * so the header reports it and the rows carry on showing what is genuinely known.
 */

import { useMemo } from "react";
import type { JSX } from "react";

import { formatCompact, formatRelativeTime, truncateAddress, truncateHash } from "../lib/format.ts";
import { useLive, marketChannel } from "../lib/live.ts";

import styles from "./LiveTape.module.css";

export interface TapeRow {
  readonly txHash: string;
  readonly blockNumber: string;
  readonly side: string;
  readonly trader: string;
  readonly notional: string;
  readonly tokens: string;
  readonly stockback: string;
  readonly priceAfter: string;
  readonly timestamp: number;
}

export interface LiveTapeProps {
  readonly market: string;
  readonly quoteDecimals: number;
  /** Rows rendered on the server. The socket adds to these. */
  readonly initial: readonly TapeRow[];
}

export function LiveTape({ market, quoteDecimals, initial }: LiveTapeProps): JSX.Element {
  const channels = useMemo(() => [marketChannel(market)], [market]);
  const { connection, messages } = useLive(channels);

  const rows = useMemo(() => {
    const live: TapeRow[] = [];

    for (const message of messages) {
      if (message.type !== "trade") continue;
      if (message.market.toLowerCase() !== market.toLowerCase()) continue;

      live.push({
        txHash: message.txHash,
        blockNumber: message.blockNumber,
        side: message.side,
        trader: message.trader,
        notional: message.notional,
        tokens: message.tokens,
        stockback: message.stockback,
        priceAfter: message.priceAfter,
        timestamp: message.timestamp,
      });
    }

    // Keyed on the transaction hash, so a trade seen live and then again in a
    // server render appears once rather than twice.
    const seen = new Set<string>();
    return [...live, ...initial]
      .filter((row) => {
        const key = row.txHash.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 50);
  }, [messages, initial, market]);

  // Computed once per render rather than per row, so every relative time on a
  // given paint is measured from the same instant.
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className={styles.root}>
      <header className={styles.head}>
        <h2 className={styles.title}>Activity</h2>
        <span className={styles.status} data-state={connection}>
          {connection === "open"
            ? "Live"
            : connection === "connecting"
              ? "Connecting"
              : connection === "degraded"
                ? "Some trades missed"
                : "Reconnecting"}
        </span>
      </header>

      {connection === "degraded" && (
        <p className={styles.degraded} role="status">
          The connection dropped and the missed trades could not be replayed. Reload to
          rebuild this list from the indexer.
        </p>
      )}

      {rows.length === 0 ? (
        <p className={styles.empty}>No trades yet. The first one will appear here.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Side</th>
                <th scope="col">Size</th>
                <th scope="col">Notional</th>
                <th scope="col">Stockback</th>
                <th scope="col">Trader</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.txHash}>
                  <td className={row.side === "BUY" ? "up" : "down"}>{row.side}</td>
                  <td className="num">{safe(row.tokens, 18)}</td>
                  <td className="num">{safe(row.notional, quoteDecimals)}</td>
                  {/* §316: the split is shown, never folded into one figure. */}
                  <td className="num dim">{safe(row.stockback, quoteDecimals)}</td>
                  <td className="mono dim">{truncateAddress(row.trader)}</td>
                  <td className="dim" title={truncateHash(row.txHash)}>
                    {formatRelativeTime(row.timestamp, now)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Format a wire quantity, or an em dash.
 *
 * A malformed value must not throw inside a table row and take the page with it,
 * and must not render as "0" — a zero is a number a user would believe.
 */
function safe(value: string, decimals: number): string {
  return /^-?\d+$/.test(value) ? formatCompact(BigInt(value), decimals) : "—";
}

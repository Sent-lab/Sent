/**
 * SENT — updates (§162).
 *
 * A changelog. Newest first, dated, and specific about what changed.
 *
 * ENTRIES DESCRIBE WHAT HAPPENED, INCLUDING THE BAD PARTS
 * -------------------------------------------------------
 * A changelog that lists only features is marketing with timestamps. The entries
 * below include bugs found and fixed, because for a product that handles money
 * the interesting question is not what was added — it is what was wrong and how
 * it was caught.
 *
 * Nothing here is dated in the future and nothing is marked shipped that is not.
 * §223's prohibitions apply to this page for the same reason they apply to the
 * roadmap.
 */

import type { JSX } from "react";

import styles from "./updates.module.css";

export const metadata = { title: "Updates" };

interface Entry {
  /** ISO date. Rendered, never parsed into a relative string — a changelog
      entry saying "3 days ago" is useless the moment it is read later. */
  readonly date: string;
  readonly title: string;
  readonly items: readonly string[];
}

const ENTRIES: readonly Entry[] = [
  {
    date: "2026-09-03",
    title: "Live updates, the chart, and four bugs found by opening the page",
    items: [
      "Trades now reach the browser without a refresh. Events are published inside the transaction that writes them, so nothing is announced for a block that rolled back, and a reconnect replays the gap rather than silently resuming.",
      "Price chart: candlesticks, volume, six timeframes, crosshair, and a graduation marker placed in the bucket the event actually happened in.",
      "Fixed: the realtime service replaced every client's session on each flush tick, discarding its subscriptions. A browser could connect, subscribe, and then receive nothing for the rest of its life.",
      "Fixed: the API sent no CORS headers, so the browser could not call it at all — every endpoint worked from the command line and none worked from the app.",
      "Fixed: a market with one trade rendered as a single slab across the whole chart. The test asserting that behaviour was itself wrong.",
      "Fixed: the chart panel collapsed to less than half its box, because a percentage height had nothing to resolve against.",
    ],
  },
  {
    date: "2026-09-03",
    title: "Web application, and a display bug caught by running it",
    items: [
      "Design system built from the locked brand palette, with two modes: cinematic on discovery surfaces, calm and dense in the trading terminal.",
      "Homepage, explore, token terminal, create, account, roadmap and this page.",
      "The trade panel renders the transaction it would sign rather than a separately computed estimate, so the review and the calldata cannot disagree.",
      "Fixed: explore cards had no quote decimals to work with and assumed eighteen, which renders a six-decimal xStock price a trillion times too small. Found by opening the page, not by reading the code.",
      "Fixed: prices used a fixed six decimal places, rendering anything below a cent as 0.000000.",
    ],
  },
  {
    date: "2026-09-02",
    title: "Backend services, and a bug that would have stopped indexing forever",
    items: [
      "Stockback finalizer: computes distributions from settled chain state, proposes them, and deliberately cannot sign them.",
      "Background workers: candle aggregation, holder reconciliation and a health sweep, each idempotent with bounded retry and a dead-letter queue.",
      "Deployment script that refuses to hand mainnet governance to an ordinary wallet.",
      "Integration suite running the projection SQL against a real PostgreSQL — 123 checks over code that had never been executed.",
      "Fixed: balances were accumulated with an upsert whose constraint check runs against the proposed row before the conflict resolves. Every sell would have thrown inside the indexer's transaction, so the first sell on the first market would have stopped indexing permanently.",
    ],
  },
  {
    date: "2026-09-01",
    title: "Audit pass over everything built so far",
    items: [
      "Graduation read the market's token balance instead of deriving it from curve state, so a donation could double the tokens migrated and open the pool at roughly half price. Now derived, and raised to an invariant.",
      "Creator fee rounding floored in two places rather than one; both now route through a single implementation.",
      "Fee settlement booked normalised amounts into vaults that pay out raw units — a factor of a trillion at six decimals, and permanently unclaimable creator fees.",
      "Two tests were found to be vacuously true and were replaced with ones that can fail.",
    ],
  },
  {
    date: "2026-08-31",
    title: "Contracts, economics and the indexer",
    items: [
      "Linear bonding curve in xStock quote units, one billion fixed supply, no creator or platform allocation.",
      "1% core trading fee split 65/35 between creator and platform, locked.",
      "Stockback at +1% on buys and +2% on sells, paid in the paired xStock.",
      "Closed-form curve maths that does not overflow a uint256, with the rescaling that makes it possible and the tests that prove it.",
    ],
  },
];

export default function UpdatesPage(): JSX.Element {
  return (
    <div className={`${styles.page} container`} data-mode="experience">
      <header className={styles.head}>
        <h1 className={styles.title}>Updates</h1>
        <p className={styles.subtitle}>
          What changed, when, and what turned out to be wrong. Nothing here is shipped to
          mainnet yet — SENT is pre-audit and not deployed.
        </p>
      </header>

      <ol className={styles.entries}>
        {ENTRIES.map((entry) => (
          // Keyed on date AND title: two entries can share a day, and a
          // duplicate key makes React reuse the wrong DOM node between them.
          <li key={`${entry.date}-${entry.title}`} className={styles.entry}>
            <div className={styles.entryHead}>
              {/* A machine-readable date and a rendered one. Never relative: a
                  changelog line reading "3 days ago" is wrong by the next week. */}
              <time className={`${styles.date} num`} dateTime={entry.date}>
                {formatDate(entry.date)}
              </time>
              <h2 className={styles.entryTitle}>{entry.title}</h2>
            </div>

            <ul className={styles.items}>
              {entry.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Render an ISO date.
 *
 * Fixed to en-GB with a UTC time zone rather than the visitor's locale: the
 * server and the browser must produce the same string, or React reports a
 * hydration mismatch and the date flickers on first paint.
 */
function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * SENT — what the platform has actually done (§166, §168, §213).
 *
 * §213 lists supporting stats as the homepage's last priority and the page had
 * none; `/platform/stats` was served and unread.
 *
 * WHY THE VOLUME FIGURES ARE NOT HERE
 * -----------------------------------
 * The API sums them across every market: `SUM(notional) FROM trades`, with no
 * conversion. Markets are quoted in different xStocks, so that total adds TSLAx
 * notionals to NVDAx notionals and the result is a number with no unit. The same
 * goes for `creatorFeesEarned` and `stockbackDistributed`.
 *
 * Rendering one as "Total volume: 1.2M" would imply a currency that does not
 * exist, and §168 rules out exactly that — a metric becomes vanity by being
 * presented without saying what produced it, and a cross-asset sum presented as
 * a single amount is worse: it says something untrue about what produced it.
 *
 * So this shows the counts, which are unambiguous, and leaves the sums to a
 * version of the endpoint that either converts to USD — which needs the display
 * feed V-11 is waiting on — or reports per asset. That is an API change, not a
 * formatting one, and inventing a unit here would hide the problem rather than
 * leave it visible.
 *
 * PROVENANCE IS ON EVERY FIGURE (§87, §168)
 * -----------------------------------------
 * Each value carries how it was produced and the block it is true as of. §87
 * gives every value a provenance and until now nothing in this app rendered one.
 * A per-figure badge would be noise on six tiles that share two sources, so it
 * is in the accessible title and summarised once underneath.
 */

import { getPlatformStats, isOk } from "../lib/api.ts";
import { formatCompact } from "../lib/format.ts";

import styles from "./PlatformStats.module.css";
import type { JSX } from "react";

/** How a `Sourced` figure describes itself to a reader who asks. */
function provenanceOf(value: { provenance: string; asOfBlock?: string }): string {
  const source =
    value.provenance === "INDEXED"
      ? "Counted from indexed events"
      : value.provenance === "CALCULATED"
        ? "Computed from indexed events"
        : value.provenance;

  return value.asOfBlock === undefined
    ? source
    : `${source}, as of block ${value.asOfBlock}`;
}

function count(value: string): string {
  return /^\d+$/.test(value) ? formatCompact(BigInt(value), 0) : "—";
}

export async function PlatformStats(): Promise<JSX.Element | null> {
  // Cached briefly: these move slowly and the homepage is the most-hit route.
  const result = await getPlatformStats({ revalidateSeconds: 30 }).catch(() => null);

  // No panel rather than an empty one. A stats strip full of dashes says the
  // product has nothing to show, when what is true is that we could not ask.
  if (result === null || !isOk(result)) return null;

  const s = result.data;
  const hours = Math.round(s.windowSeconds / 3600);

  return (
    <section className={styles.stats} aria-label="Platform statistics">
      <dl className={styles.grid}>
        <Stat term="Markets launched" value={s.totalLaunches} />
        <Stat term="On the curve" value={s.activePreGrad} />
        <Stat term="Graduated" value={s.graduated} />
        <Stat term="Unique traders" value={s.uniqueTraders} />
        <Stat term="xStock pairs available" value={s.launchableXStockPairs} />
        {/* Labelled from `windowSeconds` rather than hardcoded: the API names it
            so a client never has to infer what "24h" meant. */}
        <Stat term={`Trades in ${hours}h`} value={s.trades24h} />
      </dl>

      <p className={styles.legend}>
        Every figure is counted from indexed chain events, correct as of the block
        each one names. Nothing here is estimated and nothing is rounded up.
      </p>
    </section>
  );
}

function Stat({
  term,
  value,
}: {
  term: string;
  value: { value: string; provenance: string; asOfBlock?: string };
}): JSX.Element {
  return (
    <div className={styles.stat}>
      <dt className={styles.statTerm}>{term}</dt>
      {/* §87: the provenance travels with the number, reachable rather than
          decorative — hover, and the same string in the accessible name. */}
      <dd className={`${styles.statValue} num`} title={provenanceOf(value)}>
        {count(value.value)}
      </dd>
    </div>
  );
}

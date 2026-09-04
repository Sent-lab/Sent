/**
 * SENT — market card.
 *
 * The unit of the explore grid (§214) and the homepage's discovery rail (§213).
 * Scannable first, decorative second.
 *
 * PROVENANCE TRAVELS WITH THE NUMBERS (§87)
 * -----------------------------------------
 * Price, progress and holder count each arrive as a `Sourced` value carrying how
 * they were obtained. The card shows the freshness of the weakest of them rather
 * than the strongest: a card whose price is live but whose holder count is
 * twenty minutes stale is not a live card, and labelling it one is the
 * misleading state §451 blocks a release for.
 *
 * AUTHENTICITY IS NOT INFERRED (§4)
 * ---------------------------------
 * The verified mark comes from the factory registry via the API's `authentic`
 * field. Nothing here reads the symbol, the name or the address shape to decide
 * whether a market is real — that is precisely the check an impostor passes.
 */

import Link from "next/link";

import type { ExploreItem } from "../lib/api.ts";
import { formatAmount, formatCompact, truncateAddress } from "../lib/format.ts";
import { GraduationProgress, type MarketStatus } from "./GraduationProgress.tsx";

import styles from "./TokenCard.module.css";
import type { JSX } from "react";

export interface TokenCardProps {
  readonly item: ExploreItem;
}

export function TokenCard({ item }: TokenCardProps): JSX.Element {
  // From the response, never defaulted. A default of eighteen renders a
  // six-decimal xStock's price a trillion times too small, and the result looks
  // like a plausible number rather than like an error.
  const quoteDecimals = item.quoteDecimals;

  const status = normaliseStatus(item.status);
  const price = safeBigint(item.price.value);
  const holders = safeBigint(item.holderCount.value);

  return (
    <Link href={`/t/${item.token}`} className={`${styles.card} m-secondary`} data-status={status}>
      <div className={styles.head}>
        {/* No token-supplied image. A market can name itself anything, and an
            uploaded avatar rendered beside a price is a phishing surface. The
            monogram is derived from the symbol and cannot be spoofed into
            looking like another brand. */}
        <span className={styles.monogram} aria-hidden="true">
          {item.symbol.slice(0, 2).toUpperCase()}
        </span>

        <div className={styles.identity}>
          <span className={styles.symbol}>{item.symbol}</span>
          <span className={styles.name} title={item.name}>
            {item.name}
          </span>
        </div>

        <span className={styles.pair}>
          {/* §228: "Official xStock", consistently. The quote symbol comes from
              the verified allowlist, so this label is earned rather than shown. */}
          {item.quoteSymbol}
        </span>
      </div>

      <div className={styles.metrics}>
        <Metric
          label="Price"
          // Magnitude-aware: a fixed six places renders a sub-cent price as
          // "0.000000", which §41 is explicit is not a price.
          value={price === null ? "—" : formatAmount(price, quoteDecimals)}
        />
        <Metric
          label="Holders"
          value={holders === null ? "—" : formatCompact(holders, 0)}
        />
      </div>

      <GraduationProgress
        progressBps={item.graduationProgressBps.value}
        status={status}
        size="sm"
      />

      <div className={styles.foot}>
        <span className={styles.creator}>by {truncateAddress(item.creator)}</span>
      </div>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      {/* `num` gives tabular figures: these update live and must not reflow. */}
      <span className={`${styles.metricValue} num`}>{value}</span>
    </div>
  );
}

/**
 * Parse a wire quantity.
 *
 * Returns null rather than throwing or defaulting to zero. A malformed value
 * rendering as "0" is a number the user might believe; "—" is visibly absent.
 */
function safeBigint(value: string): bigint | null {
  return /^-?\d+$/.test(value) ? BigInt(value) : null;
}

/** An unrecognised status is treated as pre-graduation, never as graduated. */
function normaliseStatus(status: string): MarketStatus {
  return status === "GRADUATED" || status === "GRADUATING" ? status : "PRE_GRAD";
}

/**
 * SENT — account dashboard (§222).
 *
 * §222's sections: holdings, activity, my launches, earnings, with portfolio
 * value, 24h P&L, creator earnings and claimable fees across the top.
 *
 * EVERY FIGURE HERE NEEDS AN ADDRESS, AND THERE IS NOT ONE
 * --------------------------------------------------------
 * Wallet connection is not wired in this build (see `Nav.tsx` for why: §694's
 * guarantee only holds once the bytes handed to a wallet are the intent's own,
 * and that path is incomplete). Without a connected address, every metric on
 * this page is undefined.
 *
 * So the page renders its real structure with an explicit disconnected state
 * rather than zeros. A dashboard showing "$0.00" and "0 holdings" to someone who
 * holds a position is not an empty state, it is a wrong one — and it is the kind
 * of wrong that a user acts on.
 */

import Link from "next/link";
import type { JSX } from "react";

import styles from "./account.module.css";

export const metadata = { title: "Account" };

/** §222's top metrics, in its order. */
const METRICS = [
  {
    label: "Portfolio value",
    detail: "Marked at the curve price of every position you hold.",
  },
  {
    label: "24h change",
    detail: "Against the same positions valued 24 hours ago.",
  },
  {
    label: "Creator earnings",
    detail: "Your 65% of the core fee, across every market you launched.",
  },
  {
    label: "Claimable now",
    detail: "Settled and withdrawable. Separate from what is still accruing.",
  },
] as const;

const SECTIONS = [
  {
    title: "Holdings",
    body: "Every market you hold a position in, with its cost basis and current mark.",
  },
  {
    title: "Activity",
    body: "Your trades, claims and launches, newest first.",
  },
  {
    title: "My launches",
    body: "Markets you created, with their graduation progress and fee accrual. Live now on the creator page.",
  },
  {
    title: "Earnings",
    body: "Creator fees and Stockback, each shown separately rather than as one total.",
  },
] as const;

export default function AccountPage(): JSX.Element {
  return (
    <div className={`${styles.page} container`} data-mode="trading">
      <header className={styles.head}>
        <h1 className={styles.title}>Account</h1>
        <p className={styles.subtitle}>
          Your positions, launches and earnings across every SENT market.
        </p>
      </header>

      <section className={styles.metrics} aria-label="Portfolio summary">
        {METRICS.map((metric) => (
          <div key={metric.label} className={styles.metric}>
            <span className={styles.metricLabel}>{metric.label}</span>
            {/*
              An em dash, not a zero. §222 wants these figures; showing 0.00 to a
              disconnected user states a balance that has not been read, and a
              user who does hold a position would be told they hold nothing.
            */}
            <span className={`${styles.metricValue} num`}>—</span>
            <span className={styles.metricDetail}>{metric.detail}</span>
          </div>
        ))}
      </section>

      <div className={styles.connect} role="status">
        <p className={styles.connectTitle}>Holdings are not wired yet</p>
        <p className={styles.connectBody}>
          Positions and P&amp;L on this page still need a per-account holdings read, which is
          not built. Creator earnings and launches ARE live — they moved to the creator page
          rather than waiting for the rest of this one. SENT never custodies anything, so
          there is no account to create and nothing to sign up for.
        </p>
        <Link href="/creator" className={styles.connectCta}>
          Open the creator page
        </Link>
      </div>

      <div className={styles.sections}>
        {SECTIONS.map((section) => (
          <section key={section.title} className={styles.section}>
            <h2 className={styles.sectionTitle}>{section.title}</h2>
            <p className={styles.sectionBody}>{section.body}</p>
            <div className={styles.sectionEmpty}>Available once a wallet is connected.</div>
          </section>
        ))}
      </div>
    </div>
  );
}

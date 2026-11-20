/**
 * SENT — roadmap (§223).
 *
 * Four states: LIVE, BUILDING, NEXT, EXPLORING.
 *
 * WHAT §223 FORBIDS, AND WHY EACH IS TEMPTING
 * -------------------------------------------
 * No fake ETA. A date on a roadmap item is read as a commitment, and none of
 * these have one — the honest answer is the state, not a month.
 *
 * No fake completion percent. A bar at "70%" implies a measurement that does not
 * exist. Progress here is a state change, and states do not have fractions.
 *
 * No scroll hijack. The page scrolls the way every other page scrolls.
 *
 * No obscured status text. The state is a word, always readable, never carried
 * by colour alone (§84).
 *
 * THE CONTENT IS TRUE
 * -------------------
 * Every item below reflects the actual state of this repository. Items blocked
 * on external verification say so and name the ledger entry, because "EXPLORING"
 * without a reason is indistinguishable from "not started".
 */

import type { JSX } from "react";

import styles from "./roadmap.module.css";

export const metadata = { title: "Roadmap" };

type State = "LIVE" | "BUILDING" | "NEXT" | "EXPLORING";

interface Item {
  readonly title: string;
  readonly state: State;
  readonly body: string;
}

const STATE_ORDER: State[] = ["LIVE", "BUILDING", "NEXT", "EXPLORING"];

const STATE_COPY: Record<State, string> = {
  LIVE: "Shipped and running.",
  BUILDING: "Actively being worked on.",
  NEXT: "Committed, not yet started.",
  EXPLORING: "Under consideration or blocked on something external.",
};

const ITEMS: readonly Item[] = [
  {
    title: "Bonding curve and market contracts",
    state: "BUILDING",
    body: "Core contracts are deployed on HyperEVM, but the factory is not launch-enabled: no reference-price source, launchable asset or graduation router is configured. Public mainnet launch remains closed; the contract set has not had an external security audit.",
  },
  {
    title: "Stockback",
    state: "BUILDING",
    body: "24h time-weighted holder accounting, cumulative Merkle commitments, permissionless submission. The distribution pipeline is deterministic across independent nodes and proven so by simulation.",
  },
  {
    title: "Indexer and projection",
    state: "BUILDING",
    body: "Reorg-safe ingestion into a rebuildable PostgreSQL projection. The chain stays the only authority; the database can be dropped and replayed from genesis.",
  },
  {
    title: "Trading terminal",
    state: "BUILDING",
    body: "Chart, live tape, market metrics and a trade panel that renders the signed transaction rather than a recomputed estimate.",
  },
  {
    title: "Live updates",
    state: "BUILDING",
    body: "Trades reach the browser without a refresh. Events are published on commit, so nothing is announced for a block that rolled back, and a reconnect replays the gap or says it could not.",
  },
  {
    title: "Price chart",
    state: "BUILDING",
    body: "Candlesticks, volume, six timeframes, crosshair, graduation marker, wheel-to-zoom and drag-to-pan, drawn from integer prices so nothing is rounded on its way to the screen. Drawing tools and indicator overlays are not built.",
  },
  {
    title: "Wallet connection and signing",
    state: "BUILDING",
    body: "Browser wallet connection, network switching and reviewed transaction intents are wired in the app. Wallet-by-wallet release verification against the configured production deployment is still outstanding.",
  },
  {
    title: "Creator control centre",
    state: "BUILDING",
    body: "Launches, graduation progress and fee earnings for anyone who has launched a token, with claims sent straight to the fee vault. Two fee figures, never one: what the vault will pay now, and what has been earned all time.",
  },
  {
    title: "xStock wrapper and registry gates",
    state: "EXPLORING",
    body: "HyperEVM xStocks exist, but SENT's launchable share-backed wrapper is not configured. Transfer behavior, decimals, multiplier conversion, Core mapping, price source, accounting and distribution gates still need evidence before governance enables a pair (V-02, V-03, V-05).",
  },
  {
    title: "Graduation to permanent liquidity",
    state: "EXPLORING",
    body: "HyperSwap V3 dependencies have been verified and a SENT lock/router deployment script is prepared, but SENT's own router and permanent lock are not deployed or connected to the factory. No launch should be enabled until the pair is deployed and verified (V-06, V-09).",
  },
  {
    title: "Security audit",
    state: "EXPLORING",
    body: "Not scheduled. Nothing here should hold real value until it has been through one.",
  },
];

export default function RoadmapPage(): JSX.Element {
  return (
    <div className={`${styles.page} container`} data-mode="experience">
      <header className={styles.head}>
        <h1 className={`${styles.title} m-primary`}>Roadmap</h1>
        <p className={`${styles.subtitle} m-secondary`}>
          Where each piece actually stands. No dates, because a date on this page would
          be a guess wearing a commitment&rsquo;s clothes.
        </p>
      </header>

      <div className={styles.groups}>
        {STATE_ORDER.map((state) => {
          const items = ITEMS.filter((item) => item.state === state);
          if (items.length === 0) return null;

          return (
            <section key={state} className={styles.group} aria-labelledby={`state-${state}`}>
              <header className={`${styles.groupHead} m-secondary`}>
                {/* The state is a word first. Colour reinforces it and never
                    carries it alone (§84). */}
                <h2 className={styles.groupTitle} id={`state-${state}`} data-state={state}>
                  {state}
                </h2>
                <p className={styles.groupCopy}>{STATE_COPY[state]}</p>
              </header>

              <ul className={styles.items}>
                {items.map((item) => (
                  <li key={item.title} className={`${styles.item} m-ambient`} data-state={state}>
                    <h3 className={styles.itemTitle}>{item.title}</h3>
                    <p className={styles.itemBody}>{item.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <footer className={styles.footer}>
        <p>
          Verification items referenced above (V-02, V-06 and the rest) are tracked in the
          repository&rsquo;s verification ledger, with the evidence behind each one.
        </p>
      </footer>
    </div>
  );
}

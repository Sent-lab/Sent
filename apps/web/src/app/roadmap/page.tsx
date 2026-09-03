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
    body: "Linear curve, fixed supply, 1% core fee split 65/35, automatic in-transaction graduation. Written, fuzzed and covered by invariants; not yet audited and not deployed.",
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
    body: "Candlesticks, volume, six timeframes, crosshair and a graduation marker, drawn from integer prices so nothing is rounded on its way to the screen. Zoom and overlays are not built.",
  },
  {
    title: "Wallet connection and signing",
    state: "NEXT",
    body: "The transaction builder is complete and byte-for-byte tested against the contracts. Connecting a wallet is the remaining step.",
  },
  {
    title: "Creator control centre",
    state: "NEXT",
    body: "Fee accrual, claims and per-market analytics for people who have launched a token.",
  },
  {
    title: "xStock registry",
    state: "EXPLORING",
    body: "Blocked on verification of the official xStock contract addresses, their decimals and their Core token indices (V-02, V-03, V-05). These are facts about other people's contracts and will not be guessed.",
  },
  {
    title: "Graduation to permanent liquidity",
    state: "EXPLORING",
    body: "Blocked on confirming HyperSwap's position manager and the lock primitive that makes the position permanently non-withdrawable (V-06, V-09). Until both are verified, a launched market could trade but could not graduate.",
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
        <h1 className={styles.title}>Roadmap</h1>
        <p className={styles.subtitle}>
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
              <header className={styles.groupHead}>
                {/* The state is a word first. Colour reinforces it and never
                    carries it alone (§84). */}
                <h2 className={styles.groupTitle} id={`state-${state}`} data-state={state}>
                  {state}
                </h2>
                <p className={styles.groupCopy}>{STATE_COPY[state]}</p>
              </header>

              <ul className={styles.items}>
                {items.map((item) => (
                  <li key={item.title} className={styles.item} data-state={state}>
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

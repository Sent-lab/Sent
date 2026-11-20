"use client";

/**
 * SENT — the transaction center (§61).
 *
 * §61 asks for one place that knows what the wallet is doing: states for
 * pending, confirming, confirmed and failed; non-blocking; reachable from the
 * header; carried across navigation; linking back to the token it belongs to.
 *
 * NON-BLOCKING IS THE WHOLE POINT
 * -------------------------------
 * A modal that owns the screen until a transaction lands is the pattern this
 * replaces. Someone who has just bought should be able to open the market, look
 * at the chart, and buy something else while the first is still in flight. So
 * this is a header control with a popover: it reports, it does not detain.
 *
 * It is deliberately not a toast either. A toast expires, and a transaction that
 * takes longer than the toast becomes a transaction nobody is watching. The
 * count sits in the header for as long as there is something to count.
 *
 * WHAT THE SUMMARY SAYS
 * ---------------------
 * The summary comes from the intent the user actually reviewed and signed, not
 * from a label written here. §694 makes the review the source of truth for what
 * a transaction is; a header that paraphrased it would be a fifth description of
 * the same action and the one most likely to drift.
 *
 * WHY THIS ONE IS NOT A `dialog`
 * ------------------------------
 * The mobile trade sheet uses a native `dialog` because it wants everything
 * `showModal()` provides: a focus trap, an inert page, a backdrop. This wants
 * none of those — §61 says non-blocking, and every one of them blocks.
 *
 * `dialog.show()` — the non-modal form — would give the element without the
 * behaviour: no focus trap and no Escape, both of which would have to be written
 * by hand anyway, plus a top-layer element that ignores the header's stacking
 * and positioning. So this is a positioned div with `role="dialog"`, and the two
 * things a popover genuinely needs, Escape and outside-click, are wired below.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import {
  clearSettled,
  explorerUrl,
  isOpen,
  useTransactions,
  type TrackedTx,
  type TxStatus,
} from "../lib/transactions.ts";
import { truncateAddress } from "../lib/format.ts";

import styles from "./TransactionCenter.module.css";

/**
 * Wording per state. Each says what is true, not how to feel about it.
 *
 * "Submitted" rather than the shorter "Sent": in this application's own header,
 * a row labelled SENT reads as the brand rather than as a state, which is the
 * one word this list cannot afford to be ambiguous about.
 */
const LABEL: Record<TxStatus, string> = {
  PENDING: "Submitted",
  CONFIRMING: "Confirming",
  CONFIRMED: "Confirmed",
  FAILED: "Failed",
};

export function TransactionCenter(): JSX.Element | null {
  const transactions = useTransactions();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const close = useCallback((): void => setOpen(false), []);

  /*
   * Escape and a click elsewhere both close, because `show()` gives neither.
   * `pointerdown` rather than `click`: a click that starts inside the panel and
   * ends outside — a drag on a text selection — should not dismiss it.
   */
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };

    const onPointer = (event: PointerEvent): void => {
      const el = wrap.current;
      if (el !== null && !el.contains(event.target as Node)) close();
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  /*
   * Nothing tracked, nothing rendered. An empty control in the header would be
   * a permanent affordance for a thing that has never happened, and §168 is
   * against exactly this kind of decoration.
   *
   * The list is empty on the server too, so the header hydrates identically and
   * the control appears only after a transaction exists.
   */
  if (transactions.length === 0) return null;

  const pending = transactions.filter(isOpen).length;
  const failed = transactions.some((t) => t.status === "FAILED");

  return (
    <div className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={styles.trigger}
        data-busy={pending > 0 ? "true" : undefined}
        data-failed={pending === 0 && failed ? "true" : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {/* The dot is state, and the text beside it repeats that state in words
            — §84 does not allow colour to carry meaning alone. */}
        <span className={styles.dot} aria-hidden="true" />
        {pending > 0 ? `${pending} pending` : "Activity"}
      </button>

      <div
        className={styles.panel}
        role="dialog"
        aria-label="Transaction activity"
        hidden={!open}
      >
        <div className={styles.head}>
          <h2 className={styles.title}>Activity</h2>
          {transactions.some((t) => !isOpen(t)) && (
            <button type="button" className={styles.clear} onClick={clearSettled}>
              Clear settled
            </button>
          )}
        </div>

        <ul className={styles.list}>
          {transactions.map((tx) => (
            <Row key={tx.hash} tx={tx} onNavigate={close} />
          ))}
        </ul>

        <p className={styles.foot}>
          Kept in this browser only, and only until you clear it.
        </p>
      </div>
    </div>
  );
}

function Row({ tx, onNavigate }: { tx: TrackedTx; onNavigate: () => void }): JSX.Element {
  const explorer = explorerUrl(tx.hash);

  return (
    <li className={styles.row} data-status={tx.status}>
      <div className={styles.rowHead}>
        <span className={styles.state}>{LABEL[tx.status]}</span>
        <span className={styles.hash} title={tx.hash}>
          {truncateAddress(tx.hash, 6, 4)}
        </span>
      </div>

      <p className={styles.summary}>{tx.summary}</p>

      <div className={styles.rowFoot}>
        {/* Deep link to the market this belongs to (§61). Closing on navigate,
            because a popover left open over the page it just moved to is a
            panel the user has to dismiss before they can read the thing they
            asked for. */}
        {tx.token !== undefined && (
          <Link href={`/t/${tx.token}`} className={styles.link} onClick={onNavigate}>
            View market
          </Link>
        )}

        {/* Only when the deployment names an explorer. §61 says "where
            available", and a guessed URL is worse than no link: it sends
            someone to a page that does not know this chain. */}
        {explorer !== null && (
          <a
            className={styles.link}
            href={explorer}
            target="_blank"
            rel="noopener noreferrer"
          >
            Explorer
          </a>
        )}
      </div>
    </li>
  );
}

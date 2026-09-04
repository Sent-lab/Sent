"use client";

/**
 * SENT — the review a signable action shows before it is signed (§694).
 *
 * WHY THIS IS ONE COMPONENT AND NOT ONE PER ACTION
 * ------------------------------------------------
 * §694 says what the user reviews is what they sign. That holds only if the
 * review comes from the intent itself, so this renders the builder's own rows,
 * in the builder's order, with the builder's labels and values, and reformats
 * nothing. Re-deriving a display string from a raw field here would reintroduce
 * exactly the divergence the rule exists to prevent.
 *
 * Because it reads only the intent, it is the same component for a buy, a sell,
 * an approval and a graduation finalise. An action that rendered its own review
 * would be free to describe itself differently from what it encoded.
 */

import type { WireIntent } from "../lib/api.ts";

import styles from "./IntentReview.module.css";
import type { JSX } from "react";

/**
 * Render the intent's own review rows.
 *
 * Rows are rendered in the order the builder produced them, with its own labels
 * and its own values. Nothing is reformatted: re-deriving a display string from
 * a raw field would reintroduce exactly the divergence §694 exists to prevent.
 */
export function IntentReview({ intent, pending }: { intent: WireIntent; pending: boolean }): JSX.Element {
  const review = intent.review;

  return (
    <div className={pending ? styles.reviewStale : styles.reviewFresh}>
      <p className={styles.summary}>{review.summary}</p>

      <dl className={styles.rows}>
        {review.rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className={row.primary === true ? styles.rowPrimary : styles.row}
            data-warning={row.warning === true ? "true" : undefined}
          >
            <dt>{row.label}</dt>
            <dd className="num">{row.value}</dd>
          </div>
        ))}
      </dl>

      {/*
        §411 and V-19. A crossing order executes on the curve and then on
        HyperSwap, and until the router can quote the second leg the estimate
        covers only part of the route and the slippage bound protects only part
        of it. Presenting either as a whole figure would be a lie of omission on
        the one screen where it matters most.
      */}
      {review.estimateIsPartial === true && (
        <p className={styles.partial}>
          This order finishes the curve and continues into the pool. The estimate above
          covers the curve portion only.
        </p>
      )}

      {review.boundCoversPartialRoute === true && (
        <p className={styles.warning}>
          Your slippage limit applies to the curve portion of this order. The portion that
          executes in the pool is not covered by it.
        </p>
      )}

      {/* The signed bytes, available rather than hidden. A user who wants to
          verify what they are about to sign should not have to open a console. */}
      <details className={styles.calldata}>
        <summary>Transaction detail</summary>
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>To</dt>
            <dd className="mono">{intent.to}</dd>
          </div>
          <div className={styles.row}>
            <dt>Value</dt>
            <dd className="mono">{intent.value}</dd>
          </div>
          {intent.deadline !== undefined && (
            <div className={styles.row}>
              <dt>Deadline</dt>
              <dd className="mono">{intent.deadline}</dd>
            </div>
          )}
        </dl>
        <pre className={styles.data}>{intent.data}</pre>
      </details>
    </div>
  );
}

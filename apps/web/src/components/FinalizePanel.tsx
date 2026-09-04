"use client";

/**
 * SENT — finalise a graduation that is waiting (§16, §95.6, D-016).
 *
 * WHY THIS SCREEN HAS TO EXIST
 * ----------------------------
 * §16 requires `finalizeGraduation()` to be permissionless, and the contract
 * satisfies that literally: no parameter, no read of `msg.sender`, no privilege
 * for whoever sends it. But a call that only the keeper's tooling knows how to
 * construct is permissionless on paper. If the keeper is down, misconfigured,
 * or simply never written, a market sits in GRADUATING with its curve shut and
 * its pool unborn, and every holder can see the state and do nothing about it.
 *
 * The SDK has had the builder for this since D-016 and nothing called it. This
 * is the surface that makes the guarantee real: a holder who wants their market
 * unstuck can unstick it.
 *
 * THE REVIEW MUST NOT READ LIKE A CLAIM
 * -------------------------------------
 * The figures on this screen are large — the entire undistributed supply and
 * the whole curve collateral — and they are moving because of a button the user
 * pressed. Every instinct says "this is mine now". It is not: §16 excludes the
 * caller from the collateral, the LP position, creator rights and any fee
 * share.
 *
 * So the intent's own review leads with "You receive: Nothing", and this panel
 * repeats the gas cost in the open rather than letting the wallet be the first
 * place it appears. Someone paying ~5.4M gas to help a market they hold should
 * know that is what they are doing before they sign, not after.
 *
 * WHERE THE NUMBERS COME FROM
 * ---------------------------
 * Not a new API field. When the curve closes, the escrow is already determined
 * by state this page has: the undistributed supply is `TOTAL_SUPPLY -
 * distributed`, and the quote side is `curveCollateral`. §16 calls the escrow
 * deterministic precisely because nothing is left to decide, and every function
 * that could move either value is `onlyPreGrad`.
 *
 * The one conversion that matters is decimals. `curveCollateral` is NORMALIZED
 * to 18 places, the way the contract holds it; the review renders in the quote
 * asset's own units. Showing the normalized figure against a six-decimal xStock
 * would overstate the pool by a factor of a trillion.
 */

import { useMemo, useState, type JSX } from "react";

import { buildFinalizeGraduationIntent, toRawForPayout } from "@sent/sdk";
import { TOTAL_SUPPLY } from "@sent/economics";

import { useWallet, CHAIN_ID } from "../lib/wallet.ts";
import { IntentReview } from "./IntentReview.tsx";

import styles from "./FinalizePanel.module.css";

export interface FinalizePanelProps {
  readonly market: string;
  readonly symbol: string;
  readonly quoteSymbol: string;
  readonly quoteDecimals: number;
  /** Decimal strings off the wire. Never numbers (§424). */
  readonly distributed: string;
  readonly curveCollateral: string;
}

export function FinalizePanel({
  market,
  symbol,
  quoteSymbol,
  quoteDecimals,
  distributed,
  curveCollateral,
}: FinalizePanelProps): JSX.Element {
  const wallet = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intent = useMemo(() => {
    const dist = parseDecimal(distributed);
    const collateral = parseDecimal(curveCollateral);

    if (dist === null || collateral === null) return null;

    /*
     * A distributed figure above the fixed supply is impossible on chain, so if
     * one arrives the projection is wrong rather than the curve. Building an
     * intent from it would encode a negative token amount as an enormous
     * unsigned one — so nothing is built, and the panel says it cannot show the
     * numbers instead of showing invented ones.
     */
    if (dist > TOTAL_SUPPLY) return null;

    return buildFinalizeGraduationIntent({
      chainId: CHAIN_ID,
      market: market as `0x${string}`,
      tokenSymbol: symbol,
      tokenAmount: TOTAL_SUPPLY - dist,
      quoteAmount: toRawForPayout(collateral, quoteDecimals),
      quoteDecimals,
      quoteSymbol,
    });
  }, [curveCollateral, distributed, market, quoteDecimals, quoteSymbol, symbol]);

  const wire = useMemo(
    () =>
      intent === null
        ? null
        : {
            // The SDK builds with bigints and the wallet takes the wire shape.
            // Only the representation changes; no value is recomputed, which is
            // the whole of §694 in one line.
            kind: intent.kind,
            chainId: intent.chainId,
            to: intent.to,
            data: intent.data,
            value: intent.value.toString(),
            review: {
              kind: intent.review.kind,
              summary: intent.review.summary,
              rows: intent.review.rows,
            },
          },
    [intent],
  );

  async function submit(): Promise<void> {
    if (wire === null) return;

    setSubmitting(true);
    setError(null);
    setSent(null);

    try {
      setSent(await wallet.send(wire));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The transaction was not sent. Nothing changed on chain.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>This market is waiting to be finalised</h2>

      <p className={styles.body}>
        The curve closed and sold its last token. What is left is one transaction that
        mints the permanent {quoteSymbol} position and finishes the graduation. Until it
        lands, {symbol} cannot be bought or sold anywhere — the curve is shut and the
        pool does not exist yet.
      </p>

      <p className={styles.body}>
        <strong>Anyone can send it, including you.</strong> The call takes no arguments
        and does not look at who sent it, so there is nothing to race for and nothing to
        win. Whoever gets there first does the same thing, and the market opens for
        everyone.
      </p>

      {/*
        Said before the wallet says it, not after.

        This costs real money and returns nothing. A user who finds that out
        from a gas estimate they cannot interpret has been surprised by us.
      */}
      <p className={styles.cost}>
        It costs about 5.4M gas and pays the sender nothing. That is over HyperEVM&apos;s
        default 3M block limit, so the transaction only gets included if your address is
        opted into the large block lane — otherwise it will sit pending rather than fail.
      </p>

      <div className={styles.review} aria-live="polite">
        {wire === null ? (
          <p className={styles.placeholder}>
            The escrow figures for this market are not available, so there is nothing to
            review yet. Reload once market data reconnects.
          </p>
        ) : (
          <IntentReview intent={wire} pending={false} />
        )}
      </div>

      {!wallet.available ? (
        <button type="button" className={styles.submit} disabled>
          No wallet found
        </button>
      ) : wallet.address === null ? (
        <button
          type="button"
          className={styles.submit}
          onClick={() => void wallet.connect()}
          disabled={wallet.connecting}
        >
          {wallet.connecting ? "Check your wallet" : "Connect wallet"}
        </button>
      ) : wallet.wrongChain ? (
        <button type="button" className={styles.submit} onClick={() => void wallet.switchChain()}>
          Switch network
        </button>
      ) : (
        <button
          type="button"
          className={styles.submit}
          onClick={() => void submit()}
          disabled={wire === null || submitting}
        >
          {submitting ? "Confirm in your wallet" : `Finalise ${symbol}`}
        </button>
      )}

      {sent !== null && (
        <p className={styles.note}>
          Sent. Graduation completes as soon as it is included — on the large lane that
          is up to a minute. If someone else finalises first, yours reverts and costs
          only the gas already spent; the market opens either way.
        </p>
      )}

      {error !== null && <p className={styles.error}>{error}</p>}
      {wallet.error !== null && <p className={styles.error}>{wallet.error}</p>}
    </div>
  );
}

/** Decimal strings only. A malformed one yields null rather than throwing. */
function parseDecimal(value: string): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

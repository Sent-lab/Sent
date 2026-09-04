"use client";

/**
 * SENT — wrap and unwrap the quote asset (D-017).
 *
 * WHY A USER IS ASKED TO DO THIS AT ALL
 * -------------------------------------
 * Markets are quoted in a wrapper, not in the xStock itself. A Uniswap V3
 * position pays from internal liquidity accounting and has no `skim()`, so a
 * rebasing token sealed into a permanently locked position loses its dividends
 * forever and breaks outright on a reverse split. Graduation locks that position
 * for good, which makes this not a preference but the difference between a
 * market that survives a corporate action and one that does not.
 *
 * The cost lands on the user as an extra step: someone holding TSLAx must
 * approve and wrap before they can trade. That is real friction and this panel
 * says so plainly. A user who does not understand why they are signing an extra
 * transaction is a user who assumes something is wrong.
 *
 * EVERY NUMBER HERE COMES OFF THE CHAIN
 * -------------------------------------
 * Balances, allowance and the conversion rate are read with `eth_call` through
 * the wallet's own provider, not from the API (§87). The rate is the underlying
 * xStock's multiplier: it moves on dividends and splits, with no event this
 * indexer follows. There is no honest way to cache it — a user unwrapping is
 * signing against that number.
 *
 * THE TWO DIRECTIONS ARE NOT SYMMETRIC, AND THE COPY SAYS SO
 * ----------------------------------------------------------
 * `previewWrap` is an ESTIMATE: `wrap` credits the shares that actually arrive
 * rather than the shares predicted, because the underlying rounds between
 * balances and shares. `convertToAssets` is EXACT: `unwrap` pays from the same
 * function a caller reads, so quote and fill cannot disagree (§315).
 *
 * Wrapping needs an approval first; unwrapping never does, because burning your
 * own tokens needs nobody's permission. Showing an approval step for unwrap
 * would be inventing friction, and hiding one for wrap would strand the user
 * mid-flow at a revert.
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import { buildApproveIntent, buildUnwrapIntent, buildWrapIntent } from "@sent/sdk";

import { allowance, balanceOf, convertToAssets, previewWrap, symbolOf } from "../lib/chain.ts";
import { formatFixed, parseAmount } from "../lib/format.ts";
import { useWallet, CHAIN_ID } from "../lib/wallet.ts";
import { IntentReview } from "./IntentReview.tsx";

import styles from "./WrapPanel.module.css";

type Direction = "WRAP" | "UNWRAP";

export interface WrapPanelProps {
  /** The `WrappedXStock` the market is quoted in. */
  readonly wrapper: string;
  /** The rebasing xStock it holds. */
  readonly underlying: string;
  readonly wrapperSymbol: string;
  readonly decimals: number;
}

interface ChainState {
  readonly underlyingSymbol: string;
  readonly underlyingBalance: bigint;
  readonly wrapperBalance: bigint;
  readonly approved: bigint;
}

export function WrapPanel({
  wrapper,
  underlying,
  wrapperSymbol,
  decimals,
}: WrapPanelProps): JSX.Element {
  const wallet = useWallet();
  const { read, address } = wallet;

  const [direction, setDirection] = useState<Direction>("WRAP");
  const [input, setInput] = useState("");
  const [chain, setChain] = useState<ChainState | null>(null);
  const [expected, setExpected] = useState<bigint | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = useMemo(() => parseAmount(input, decimals), [input, decimals]);

  const wrapperAddress = wrapper as `0x${string}`;
  const underlyingAddress = underlying as `0x${string}`;

  /*
   * Balances, allowance and the underlying's symbol, in one pass.
   *
   * Re-read after every send rather than adjusted locally: an optimistic
   * decrement would be a second, unverified copy of the user's balance, and the
   * one number a wrap panel must not be wrong about is how much they have.
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (address === null) {
      setChain(null);
      return;
    }

    try {
      const [underlyingSymbol, underlyingBalance, wrapperBalance, approved] = await Promise.all([
        symbolOf(read, underlyingAddress),
        balanceOf(read, underlyingAddress, address),
        balanceOf(read, wrapperAddress, address),
        allowance(read, underlyingAddress, address, wrapperAddress),
      ]);

      setChain({ underlyingSymbol, underlyingBalance, wrapperBalance, approved });
      setReadError(null);
    } catch (caught) {
      setChain(null);
      setReadError(
        caught instanceof Error
          ? caught.message
          : "Could not read this wrapper from the chain.",
      );
    }
  }, [address, read, underlyingAddress, wrapperAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * The conversion, re-read as the amount changes.
   *
   * Debounced and abandoned on change: a slow answer for an old amount landing
   * after a fast one for the new amount would describe a transaction the user is
   * no longer making. `cancelled` rather than AbortSignal because `eth_call`
   * through an injected provider does not take one — the late result is simply
   * not allowed to win.
   */
  useEffect(() => {
    if (amount === null || amount === 0n) {
      setExpected(null);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(() => {
      const pending =
        direction === "WRAP"
          ? previewWrap(read, wrapperAddress, amount)
          : convertToAssets(read, wrapperAddress, amount);

      void pending
        .then((value) => {
          if (!cancelled) setExpected(value);
        })
        .catch(() => {
          if (!cancelled) setExpected(null);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amount, direction, read, wrapperAddress]);

  const inputSymbol = direction === "WRAP" ? (chain?.underlyingSymbol ?? "xStock") : wrapperSymbol;
  const balance =
    chain === null ? null : direction === "WRAP" ? chain.underlyingBalance : chain.wrapperBalance;

  const overBalance = amount !== null && balance !== null && amount > balance;

  // Only a wrap spends someone else's allowance. Burning your own tokens needs
  // nobody's permission, so an unwrap never wants this step.
  const needsApproval =
    direction === "WRAP" && amount !== null && chain !== null && chain.approved < amount;

  const intent = useMemo(() => {
    if (amount === null || amount === 0n || expected === null || chain === null) return null;

    return direction === "WRAP"
      ? buildWrapIntent({
          chainId: CHAIN_ID,
          wrapper: wrapperAddress,
          assets: amount,
          expectedShares: expected,
          decimals,
          underlyingSymbol: chain.underlyingSymbol,
          wrapperSymbol,
        })
      : buildUnwrapIntent({
          chainId: CHAIN_ID,
          wrapper: wrapperAddress,
          shares: amount,
          expectedAssets: expected,
          decimals,
          underlyingSymbol: chain.underlyingSymbol,
          wrapperSymbol,
        });
  }, [amount, chain, decimals, direction, expected, wrapperAddress, wrapperSymbol]);

  const wire = useMemo(
    () =>
      intent === null
        ? null
        : {
            // Representation only. Nothing is recomputed between the review the
            // user reads and the bytes the wallet receives (§694).
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
    if (wire === null || amount === null || chain === null) return;

    setSubmitting(true);
    setError(null);
    setSent(null);

    try {
      if (needsApproval) {
        const approval = buildApproveIntent({
          chainId: CHAIN_ID,
          token: underlyingAddress,
          spender: wrapperAddress,
          amount,
          decimals,
          symbol: chain.underlyingSymbol,
          kind: "APPROVE_QUOTE",
          // Not "this market". The spender is the wrapper contract, and a
          // review naming the wrong one describes a transaction that is not
          // happening.
          spenderRole: "this wrapper",
        });

        await wallet.send({
          kind: approval.kind,
          chainId: approval.chainId,
          to: approval.to,
          data: approval.data,
          value: approval.value.toString(),
          review: {
            kind: approval.review.kind,
            summary: approval.review.summary,
            rows: approval.review.rows,
          },
        });
      }

      setSent(await wallet.send(wire));
      setInput("");
      await refresh();
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
    <section className={styles.panel} aria-label="Wrap or unwrap the quote asset">
      <header className={styles.head}>
        <h2 className={styles.title}>Get {wrapperSymbol}</h2>
        <p className={styles.body}>
          This market is quoted in {wrapperSymbol}, a wrapper around the xStock it holds.
          The wrapper exists because a permanently locked liquidity position cannot hold a
          token whose balances move — dividends would be stranded in it and a reverse split
          would break it. Wrapping is reversible at any time, by you, with nobody&apos;s
          permission: the wrapper has no owner and no pause.
        </p>
      </header>

      <div className={styles.sides} role="group" aria-label="Direction">
        {(["WRAP", "UNWRAP"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={direction === option ? styles.sideActive : styles.side}
            aria-pressed={direction === option}
            onClick={() => {
              setDirection(option);
              setInput("");
              setExpected(null);
              setSent(null);
              setError(null);
            }}
          >
            {option === "WRAP" ? "Wrap" : "Unwrap"}
          </button>
        ))}
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          You {direction === "WRAP" ? "wrap" : "unwrap"}
        </span>

        <span className={styles.inputRow}>
          <input
            className={styles.input}
            inputMode="decimal"
            placeholder="0.00"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            aria-describedby="wrap-help"
          />
          <span className={styles.inputSuffix}>{inputSymbol}</span>
        </span>

        {/* The balance is a fact about the user's wallet, so it is read from the
            chain and offered as a button rather than left for them to type. */}
        {balance !== null && (
          <button
            type="button"
            className={styles.balance}
            onClick={() => setInput(formatFixed(balance, decimals, { places: decimals }))}
          >
            Balance {formatFixed(balance, decimals, { places: Math.min(decimals, 6) })}{" "}
            {inputSymbol}
          </button>
        )}

        {input.trim() !== "" && amount === null && (
          <span className={styles.fieldError} id="wrap-help">
            Enter an amount with at most {decimals} decimal places.
          </span>
        )}

        {overBalance && (
          <span className={styles.fieldError} id="wrap-help">
            That is more {inputSymbol} than this wallet holds.
          </span>
        )}
      </label>

      <div className={styles.review} aria-live="polite">
        {readError !== null ? (
          <p className={styles.error}>{readError}</p>
        ) : address === null ? (
          <p className={styles.placeholder}>
            Connect a wallet to see your balance and the current rate. Both are read from
            the chain, not from our indexer.
          </p>
        ) : wire === null ? (
          <p className={styles.placeholder}>
            Enter an amount to see the full breakdown before you sign.
          </p>
        ) : (
          <IntentReview intent={wire} pending={false} />
        )}
      </div>

      {needsApproval && (
        <p className={styles.note}>
          Two transactions: an approval for exactly this amount, then the wrap. The
          approval is never unlimited.
        </p>
      )}

      {!wallet.available ? (
        <button type="button" className={styles.submit} disabled>
          No wallet found
        </button>
      ) : address === null ? (
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
          disabled={wire === null || overBalance || submitting}
        >
          {submitting
            ? "Confirm in your wallet"
            : direction === "WRAP"
              ? `Wrap into ${wrapperSymbol}`
              : `Unwrap to ${chain?.underlyingSymbol ?? "the xStock"}`}
        </button>
      )}

      {sent !== null && (
        <p className={styles.note}>
          Sent. Your balance above updates once it is included.
        </p>
      )}

      {error !== null && <p className={styles.error}>{error}</p>}
      {wallet.error !== null && <p className={styles.error}>{wallet.error}</p>}
    </section>
  );
}

"use client";

/**
 * SENT — buy/sell panel.
 *
 * §694: UI REVIEW = TRANSACTION INTENT = SDK BUILDER = ACTUAL CALLDATA.
 *
 * This component computes NOTHING financial. It collects an amount, asks the API
 * for an intent, and renders `intent.review.rows` verbatim. Every figure the
 * user reads comes from the same object that carries the calldata they sign.
 *
 * That is not a stylistic preference. This codebase has already made the
 * opposite mistake once: the API hardcoded a 9700/10000 sell fee under a header
 * that said it did no fee arithmetic, producing a third implementation of a
 * number that must have exactly one. A frontend that recomputed "you receive"
 * for display would be the fourth, and would be the one the user actually reads.
 *
 * So there is no fee maths here, no slippage maths, no price maths. If a value
 * is not in the intent, it is not shown.
 *
 * SIGNING SENDS THE INTENT, NOT A RECONSTRUCTION
 * ----------------------------------------------
 * `wallet.send(intent)` passes `to`, `data` and `value` to the wallet exactly as
 * the API produced them. Nothing between the review the user reads and the
 * calldata they sign can differ, because there is nothing between them.
 *
 * APPROVAL IS A SEPARATE, EXACT-AMOUNT STEP
 * -----------------------------------------
 * A market cannot pull the quote asset without an allowance. That approval is
 * built for the EXACT trade amount rather than for `type(uint256).max` — see
 * `buildApproveIntent`. It costs an extra transaction per trade, which is the
 * right side to be wrong on for contracts that have not been audited.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildApproveIntent } from "@sent/sdk";

import { quote, isOk, type WireIntent } from "../lib/api.ts";
import { parseAmount, formatFixed } from "../lib/format.ts";
import { useWallet } from "../lib/wallet.ts";
import { FreshnessNotice } from "./Freshness.tsx";
import { IntentReview } from "./IntentReview.tsx";
import type { MarketStatus } from "./GraduationProgress.tsx";
import type { FreshnessEnvelope } from "@sent/realtime";

import styles from "./TradePanel.module.css";
import type { JSX } from "react";

type Side = "BUY" | "SELL";

/** Slippage presets in basis points. §14: the user picks, nothing is implicit. */
const SLIPPAGE_PRESETS = [50n, 100n, 300n] as const;

export interface TradePanelProps {
  readonly token: string;
  /** The market contract — the spender an approval names. */
  readonly market: string;
  readonly quoteAsset: string;
  readonly symbol: string;
  readonly quoteSymbol: string;
  readonly quoteDecimals: number;
  readonly status: MarketStatus;
  readonly freshness: FreshnessEnvelope;
}

export function TradePanel({
  token,
  market,
  quoteAsset,
  symbol,
  quoteSymbol,
  quoteDecimals,
  status,
  freshness,
}: TradePanelProps): JSX.Element {
  const wallet = useWallet();
  const [side, setSide] = useState<Side>("BUY");
  const [input, setInput] = useState("");
  const [slippageBps, setSlippageBps] = useState<bigint>(100n);
  const [intent, setIntent] = useState<WireIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  // A BUY spends the quote asset; a SELL spends the token. The decimals differ,
  // and parsing with the wrong one would misread the amount by a factor of 10^12
  // on a six-decimal xStock.
  const inputDecimals = side === "BUY" ? quoteDecimals : 18;
  const inputSymbol = side === "BUY" ? quoteSymbol : symbol;

  const amount = useMemo(() => parseAmount(input, inputDecimals), [input, inputDecimals]);

  /*
   * GRADUATING IS CLOSED FOR TRADING, AND IT WAS NOT (D-016)
   * --------------------------------------------------------
   * This panel used to ask only whether the market had GRADUATED. GRADUATING
   * therefore fell into the open branch: the form stayed live, the API was
   * asked for quotes, and the button offered to buy.
   *
   * Every one of those transactions reverts. `buy` and `sell` are `onlyPreGrad`
   * and the curve is permanently shut the moment the market enters GRADUATING —
   * so the panel was inviting people to pay gas for a guaranteed failure, on
   * exactly the markets most likely to be busy.
   *
   * The two closed states are still told apart, because what a user should do
   * next is different: a GRADUATED market sends them to the pool, a GRADUATING
   * one is waiting on a finalise that anyone can send, including them.
   */
  const graduated = status === "GRADUATED";
  const graduating = status === "GRADUATING";
  const curveClosed = graduated || graduating;

  const fetchQuote = useCallback(
    async (signal: AbortSignal) => {
      // Nothing to quote on a shut curve. Asking anyway would spend a round trip
      // to be told no, and would put a priced review in front of a trade that
      // cannot be signed.
      if (curveClosed) {
        setIntent(null);
        setError(null);
        return;
      }

      if (amount === null || amount === 0n) {
        setIntent(null);
        setError(null);
        return;
      }

      setPending(true);

      try {
        const result = await quote(
          {
            token,
            side,
            // A decimal string, never a number. This is the value the trade is
            // built from (§424).
            amount: amount.toString(),
            slippageBps: slippageBps.toString(),
          },
          { signal },
        );

        if (signal.aborted) return;

        if (isOk(result)) {
          setIntent(result.data);
          setError(null);
        } else {
          setIntent(null);
          setError(result.message);
        }
      } catch (caught) {
        if (signal.aborted) return;
        setIntent(null);
        setError(
          caught instanceof Error
            ? caught.message
            : "Market data is reconnecting. Your funds and on-chain position are unchanged.",
        );
      } finally {
        if (!signal.aborted) setPending(false);
      }
    },
    [amount, curveClosed, side, slippageBps, token],
  );

  // Debounced, and aborted on every change. Without the abort a slow response
  // for an old amount can land after a fast one for the new amount, and the
  // review would describe a trade the user is no longer making.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void fetchQuote(controller.signal), 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fetchQuote]);

  /**
   * Approve, then trade.
   *
   * Two transactions, in order, each reviewed. The approval names the market as
   * spender and the exact amount being spent — never unlimited.
   *
   * A SELL spends the launched token, a BUY spends the quote asset; approving
   * the wrong one would leave the trade reverting with an allowance error that
   * points at the other asset.
   */
  const submit = useCallback(async () => {
    if (intent === null || amount === null) return;

    setSubmitting(true);
    setError(null);
    setSent(null);

    try {
      const approval = buildApproveIntent({
        chainId: intent.chainId,
        token: (side === "BUY" ? quoteAsset : token) as `0x${string}`,
        spender: market as `0x${string}`,
        amount,
        decimals: inputDecimals,
        symbol: inputSymbol,
        kind: side === "BUY" ? "APPROVE_QUOTE" : "APPROVE_TOKEN",
      });

      // The SDK builds with bigints; the wallet sends the wire shape. Only the
      // representation changes — no value is recomputed.
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

      const hash = await wallet.send(intent);
      setSent(hash);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The transaction could not be sent. Nothing was signed.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [intent, amount, side, quoteAsset, token, market, inputDecimals, inputSymbol, wallet]);

  return (
    <div className={styles.panel}>
      {/* Sides are radio semantics, not two buttons: a screen reader should hear
          one control with two states, and arrow keys should move between them. */}
      <div className={styles.sides} role="radiogroup" aria-label="Order side">
        {(["BUY", "SELL"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={side === option}
            className={side === option ? styles.sideActive : styles.side}
            data-side={option}
            onClick={() => {
              setSide(option);
              // The amount is denominated in a different asset on the other
              // side, so carrying it over would silently re-interpret it.
              setInput("");
              setIntent(null);
              setError(null);
            }}
          >
            {option === "BUY" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          {side === "BUY" ? "You spend" : "You sell"}
        </span>

        <span className={styles.inputWrap}>
          <input
            className={`${styles.input} num`}
            // `text` with a numeric keypad, not `number`: a number input accepts
            // "1e5", scrolls to a different value on a trackpad, and rounds long
            // decimals in some browsers.
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.00"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            aria-describedby="trade-help"
            disabled={curveClosed}
          />
          <span className={styles.inputSuffix}>{inputSymbol}</span>
        </span>

        {/* Only shown once the value is invalid AND non-empty: warning at someone
            mid-way through typing is noise (§42). */}
        {input.trim() !== "" && amount === null && (
          <span className={styles.fieldError} id="trade-help">
            Enter an amount with at most {inputDecimals} decimal places.
          </span>
        )}
      </label>

      <fieldset className={styles.slippage}>
        <legend className={styles.fieldLabel}>Max slippage</legend>
        <div className={styles.slippageOptions}>
          {SLIPPAGE_PRESETS.map((preset) => (
            <button
              key={String(preset)}
              type="button"
              className={slippageBps === preset ? styles.slippageActive : styles.slippageOption}
              aria-pressed={slippageBps === preset}
              onClick={() => setSlippageBps(preset)}
            >
              {formatFixed(preset, 2, { places: 2, pad: true })}%
            </button>
          ))}
        </div>
      </fieldset>

      <FreshnessNotice envelope={freshness} />

      {/* --- Review (§694) ------------------------------------------------ */}
      <div className={styles.review} aria-live="polite" aria-busy={pending}>
        {graduated ? (
          <p className={styles.notice}>
            This market has graduated. Trading now happens in the permanently locked
            {" "}
            {quoteSymbol} pool rather than on the curve.
          </p>
        ) : graduating ? (
          <p className={styles.notice}>
            The curve is closed and the pool has not been created yet. Nothing can be
            bought or sold here until someone finalises the graduation — which anyone
            can do, including you, from the graduation panel below. Your tokens and
            your position are untouched while it waits.
          </p>
        ) : error !== null ? (
          <p className={styles.error}>{error}</p>
        ) : intent === null ? (
          <p className={styles.placeholder}>
            Enter an amount to see the full breakdown before you sign.
          </p>
        ) : (
          <IntentReview intent={intent} pending={pending} />
        )}
      </div>

      {/*
        One button, four states. Each says what will happen next rather than
        failing after the fact — a submit that is enabled and then rejects is
        the shape §42 is written against.
      */}
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
          disabled={curveClosed || intent === null || submitting}
        >
          {submitting
            ? "Confirm in your wallet"
            : graduated
              ? "Trade on the pool"
              : graduating
                ? "Waiting on finalisation"
                : `${side === "BUY" ? "Buy" : "Sell"} ${symbol}`}
        </button>
      )}

      {sent !== null ? (
        <p className={styles.submitNote}>
          Submitted. The tape updates as soon as the trade is indexed.
        </p>
      ) : wallet.address !== null && !curveClosed ? (
        <p className={styles.submitNote}>
          Two transactions: an approval for exactly this amount, then the trade. The
          approval is never unlimited.
        </p>
      ) : (
        <p className={styles.submitNote}>
          The review above is the exact transaction that gets signed.
        </p>
      )}

      {wallet.error !== null && <p className={styles.error}>{wallet.error}</p>}
    </div>
  );
}

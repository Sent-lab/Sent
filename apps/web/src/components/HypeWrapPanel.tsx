"use client";

/** Native HYPE <-> WHYPE conversion for SENT's MVP quote lane. */
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import { buildHypeWrapIntent } from "@sent/sdk";
import { WHYPE_ADDRESS } from "@sent/config";

import { balanceOf } from "../lib/chain.ts";
import { formatFixed, parseAmount } from "../lib/format.ts";
import { track } from "../lib/transactions.ts";
import { useWallet, CHAIN_ID } from "../lib/wallet.ts";
import { IntentReview } from "./IntentReview.tsx";
import styles from "./WrapPanel.module.css";

type Direction = "WRAP" | "UNWRAP";

export function HypeWrapPanel({ token }: { readonly token: string }): JSX.Element {
  const wallet = useWallet();
  const { address } = wallet;
  const [direction, setDirection] = useState<Direction>("WRAP");
  const [input, setInput] = useState("");
  const [hypeBalance, setHypeBalance] = useState<bigint | null>(null);
  const [whypeBalance, setWhypeBalance] = useState<bigint | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = useMemo(() => parseAmount(input, 18), [input]);
  const refresh = useCallback(async (): Promise<void> => {
    if (address === null) {
      setHypeBalance(null);
      setWhypeBalance(null);
      return;
    }
    try {
      const [native, wrapped] = await Promise.all([
        wallet.nativeBalance(address),
        balanceOf(wallet.read, WHYPE_ADDRESS, address),
      ]);
      setHypeBalance(native);
      setWhypeBalance(wrapped);
      setReadError(null);
    } catch (caught) {
      setHypeBalance(null);
      setWhypeBalance(null);
      setReadError(caught instanceof Error ? caught.message : "Could not read HYPE balances.");
    }
  }, [address, wallet.nativeBalance, wallet.read]);

  useEffect(() => { void refresh(); }, [refresh]);

  const balance = direction === "WRAP" ? hypeBalance : whypeBalance;
  const overBalance = amount !== null && balance !== null && amount > balance;
  const intent = useMemo(() => {
    if (amount === null || amount <= 0n || overBalance) return null;
    try {
      return buildHypeWrapIntent({ chainId: CHAIN_ID, whype: WHYPE_ADDRESS, amount, direction });
    } catch {
      return null;
    }
  }, [amount, direction, overBalance]);
  const wire = intent === null ? null : {
    kind: intent.kind,
    chainId: intent.chainId,
    to: intent.to,
    data: intent.data,
    value: intent.value.toString(),
    review: { kind: intent.review.kind, summary: intent.review.summary, rows: intent.review.rows },
  };

  async function submit(): Promise<void> {
    if (wire === null) return;
    setSubmitting(true);
    setError(null);
    setSent(null);
    try {
      const hash = await wallet.send(wire);
      track({ hash, summary: wire.review.summary, token });
      setSent(hash);
      setInput("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The transaction was not sent.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputSymbol = direction === "WRAP" ? "HYPE" : "WHYPE";
  return (
    <section className={styles.panel} aria-label="Wrap HYPE or unwrap WHYPE">
      <header className={styles.head}>
        <h2 className={styles.title}>Get WHYPE to trade</h2>
        <p className={styles.body}>This market uses WHYPE as its quote asset. Wrap and unwrap are 1:1 and reversible. Wrapping uses native HYPE; trading uses the ERC-20 WHYPE balance.</p>
      </header>
      <div className={styles.sides} role="group" aria-label="Conversion direction">
        {(["WRAP", "UNWRAP"] as const).map((option) => (
          <button key={option} type="button" className={direction === option ? styles.sideActive : styles.side}
            aria-pressed={direction === option} onClick={() => { setDirection(option); setInput(""); setError(null); }}>
            {option === "WRAP" ? "Wrap HYPE" : "Unwrap WHYPE"}
          </button>
        ))}
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Amount to {direction === "WRAP" ? "wrap" : "unwrap"}</span>
        <span className={styles.inputRow}>
          <input className={styles.input} inputMode="decimal" placeholder="0.00" value={input}
            onChange={(event) => setInput(event.target.value)} aria-label={`${inputSymbol} amount`} />
          <span className={styles.inputSuffix}>{inputSymbol}</span>
        </span>
        {balance !== null && <button type="button" className={styles.balance}
          onClick={() => setInput(formatFixed(balance, 18, { places: 18 }))}>
          Balance {formatFixed(balance, 18, { places: 6 })} {inputSymbol}
        </button>}
        {input.trim() !== "" && amount === null && <span className={styles.fieldError}>Enter a valid amount with at most 18 decimals.</span>}
        {overBalance && <span className={styles.fieldError}>That is more {inputSymbol} than this wallet holds.</span>}
      </label>
      <div className={styles.review} aria-live="polite">
        {readError !== null ? <p className={styles.error}>{readError}</p>
          : address === null ? <p className={styles.placeholder}>Connect your wallet to read native HYPE and WHYPE balances.</p>
          : wire === null ? <p className={styles.placeholder}>Enter an amount to review the exact conversion before signing.</p>
          : <IntentReview intent={wire} pending={false} />}
      </div>
      {!wallet.available ? <button type="button" className={styles.submit} disabled>No wallet found</button>
        : address === null ? <button type="button" className={styles.submit} onClick={() => void wallet.connect()} disabled={wallet.connecting}>{wallet.connecting ? "Check your wallet" : "Connect wallet"}</button>
        : wallet.wrongChain ? <button type="button" className={styles.submit} onClick={() => void wallet.switchChain()}>Switch network</button>
        : <button type="button" className={styles.submit} onClick={() => void submit()} disabled={wire === null || submitting}>{submitting ? "Confirm in your wallet" : direction === "WRAP" ? "Wrap into WHYPE" : "Unwrap to HYPE"}</button>}
      {sent !== null && <p className={styles.note}>Sent. Balances refresh after the wallet includes the transaction.</p>}
      {error !== null && <p className={styles.error}>{error}</p>}
      {wallet.error !== null && <p className={styles.error}>{wallet.error}</p>}
    </section>
  );
}

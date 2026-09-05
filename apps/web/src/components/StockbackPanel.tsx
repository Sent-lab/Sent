"use client";

/**
 * SENT — a holder's Stockback for one market (§11, §293, §365).
 *
 * The homepage advertises "+1% buy / +2% sell" as a headline term. Nothing in
 * the product showed a holder what they had accrued or let them take it:
 * `/markets/:token/stockback/:account` was served and unread, and
 * `buildClaimStockbackIntent` was built and uncalled.
 *
 * TWO NUMBERS, NEVER ONE (§293)
 * -----------------------------
 * `estimatedAccrued` is a projection of what this holder has earned so far in
 * the running epoch. `claimable` is what the vault will actually pay right now,
 * against an activated Merkle root.
 *
 * They are different amounts, they move at different times, and §293 requires
 * them to be distinguishable. The API's own note calls merging them "the
 * misleading financial UI state §451 blocks a release for" — so they are two
 * rows with two labels, and the estimate says it is one.
 *
 * THE CLAIM SENDS THE CUMULATIVE FIGURE, NOT THE PAYABLE ONE (§365)
 * -----------------------------------------------------------------
 * Entitlements are cumulative and the vault pays `cumulative - claimed`. The
 * SDK takes both — `cumulative` for the calldata, `payable` for the review — so
 * a caller cannot accidentally pass the smaller number, which would succeed and
 * claim far less than is owed.
 *
 * That is exactly why the amounts are not recomputed here. The panel shows what
 * the API returned and signs what the SDK built (§694).
 *
 * NO RECORD IS NOT AN ERROR
 * -------------------------
 * `NO_STOCKBACK_RECORD` is what a wallet that has never held this token gets.
 * It is the normal answer for most visitors and is rendered as an empty state,
 * not as a failure.
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import { buildClaimStockbackIntent } from "@sent/sdk";

import { getStockback, isOk, type StockbackResponse } from "../lib/api.ts";
import { formatQuoteCompact, formatQuoteFixed } from "../lib/format.ts";
import { useWallet, CHAIN_ID } from "../lib/wallet.ts";
import { IntentReview } from "./IntentReview.tsx";

import styles from "./StockbackPanel.module.css";

export interface StockbackPanelProps {
  readonly token: string;
  readonly market: string;
  /** The asset Stockback is paid in — the paired xStock. */
  readonly rewardSymbol: string;
}

function big(value: string | undefined): bigint {
  return value !== undefined && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

export function StockbackPanel({
  token,
  market,
  rewardSymbol,
}: StockbackPanelProps): JSX.Element | null {
  const wallet = useWallet();
  const { address } = wallet;

  const [data, setData] = useState<StockbackResponse | null>(null);
  const [noRecord, setNoRecord] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (who: string, signal: AbortSignal): Promise<void> => {
      const result = await getStockback(token, who, { signal }).catch(() => null);
      if (signal.aborted || result === null) return;

      if (isOk(result)) {
        setData(result.data);
        setNoRecord(false);
        return;
      }

      // A wallet that never held this token has no record, which is the normal
      // answer rather than a fault. Anything else is worth showing.
      setData(null);
      setNoRecord(result.code === "NO_STOCKBACK_RECORD");
      if (result.code !== "NO_STOCKBACK_RECORD") setError(result.message);
    },
    [token],
  );

  useEffect(() => {
    if (address === null) {
      setData(null);
      setNoRecord(false);
      return;
    }

    const controller = new AbortController();
    void load(address, controller.signal);
    return () => controller.abort();
  }, [address, load]);

  const claimable = big(data?.claimable.value);
  const accrued = big(data?.estimatedAccrued.value);
  const claimed = big(data?.lifetimeClaimed.value);

  const intent = useMemo(() => {
    if (data === null || address === null) return null;
    if (data.rewardVault === null) return null;

    // A claim needs an activated root: the proof and the cumulative figure come
    // together or not at all. Without them there is nothing signable, however
    // much has accrued.
    if (data.proof === undefined || data.cumulative === undefined) return null;
    if (claimable <= 0n) return null;

    return buildClaimStockbackIntent({
      chainId: CHAIN_ID,
      rewardVault: data.rewardVault as `0x${string}`,
      market: market as `0x${string}`,
      account: address,
      cumulative: big(data.cumulative),
      proof: data.proof as readonly `0x${string}`[],
      payable: claimable,
      // Stockback is paid in the quote asset, and every quote figure the API
      // serves is normalized to eighteen places (see `format.ts`).
      decimals: 18,
      symbol: rewardSymbol,
    });
  }, [data, address, market, claimable, rewardSymbol]);

  const wire = useMemo(
    () =>
      intent === null
        ? null
        : {
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
    if (wire === null || address === null) return;

    setSubmitting(true);
    setError(null);
    setSent(null);

    try {
      setSent(await wallet.send(wire));
      const controller = new AbortController();
      await load(address, controller.signal);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The claim was not sent. Nothing moved.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Your Stockback">
      <header className={styles.head}>
        <h2 className={styles.title}>Your Stockback</h2>
        <span className={styles.subtitle}>Paid in {rewardSymbol}</span>
      </header>

      {address === null ? (
        <p className={styles.empty}>
          Connect a wallet to see what you have accrued. Stockback is earned by holding —
          +1% of every buy and +2% of every sell, distributed to holders.
        </p>
      ) : noRecord ? (
        <p className={styles.empty}>
          This wallet has no Stockback record for {rewardSymbol} yet. It starts accruing as
          soon as you hold the token through an epoch.
        </p>
      ) : data === null ? (
        <p className={styles.empty}>Reading your entitlement…</p>
      ) : (
        <>
          <dl className={styles.figures}>
            {/*
              §293: the estimate and the entitlement are separate rows with
              separate labels. One is a projection of the running epoch; the
              other is money the vault will pay against an activated root.
            */}
            <Figure
              term="Claimable now"
              value={`${formatQuoteCompact(claimable)} ${rewardSymbol}`}
              detail="Settled against an activated root. This is what the vault pays."
              emphasis
            />
            <Figure
              term="Accruing this epoch"
              value={`${formatQuoteFixed(accrued)} ${rewardSymbol}`}
              detail="An estimate for the epoch in progress. It is not payable until the epoch closes and its root is activated."
            />
            <Figure
              term="Claimed so far"
              value={`${formatQuoteCompact(claimed)} ${rewardSymbol}`}
              detail="Everything this wallet has already withdrawn from this market."
            />
          </dl>

          <p className={styles.epoch}>
            Epoch {data.epochSequence}
            {data.epochEndsAt > 0 && <> · closes {new Date(data.epochEndsAt * 1000).toUTCString()}</>}
          </p>

          {wire !== null && <IntentReview intent={wire} pending={false} />}

          {wire === null && claimable > 0n && (
            <p className={styles.pending}>
              {data.rewardVault === null
                ? "The vault address could not be read from the chain, so a claim cannot be built right now. Your entitlement is unaffected."
                : "This amount is settled but its Merkle proof has not been published yet. It becomes claimable once the root is activated — nothing is lost in the meantime."}
            </p>
          )}

          {wire !== null &&
            (!wallet.available ? (
              <button type="button" className={styles.submit} disabled>
                No wallet found
              </button>
            ) : wallet.wrongChain ? (
              <button
                type="button"
                className={styles.submit}
                onClick={() => void wallet.switchChain()}
              >
                Switch network
              </button>
            ) : (
              <button
                type="button"
                className={styles.submit}
                onClick={() => void submit()}
                disabled={submitting}
              >
                {submitting ? "Confirm in your wallet" : `Claim ${rewardSymbol}`}
              </button>
            ))}

          {sent !== null && (
            <p className={styles.note}>Sent. Your figures update once it is indexed.</p>
          )}
        </>
      )}

      {error !== null && <p className={styles.error}>{error}</p>}
      {wallet.error !== null && <p className={styles.error}>{wallet.error}</p>}
    </section>
  );
}

function Figure({
  term,
  value,
  detail,
  emphasis = false,
}: {
  term: string;
  value: string;
  detail: string;
  emphasis?: boolean;
}): JSX.Element {
  return (
    <div className={emphasis ? styles.figurePrimary : styles.figure}>
      <dt className={styles.figureTerm}>{term}</dt>
      <dd className={`${styles.figureValue} num`}>{value}</dd>
      <dd className={styles.figureDetail}>{detail}</dd>
    </div>
  );
}

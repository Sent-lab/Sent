"use client";

/**
 * SENT — account dashboard (§222).
 *
 * §222's sections: holdings, activity, my launches, earnings, with portfolio
 * value, 24h P&L, creator earnings and claimable fees across the top.
 *
 * THIS PAGE USED TO SAY THE READ DID NOT EXIST
 * --------------------------------------------
 * It said "positions and P&L still need a per-account holdings read, which is
 * not built", and that stopped being true: `/accounts/:address` is routed and
 * `handleAccount` returns holdings, portfolio value, Stockback and claims. The
 * note outlived the gap it described, which is its own kind of wrong — a user
 * reading it was told the product could not do something it could.
 *
 * WHAT IS STILL NOT SERVED, AND IS SAID SO IN PLACE
 * -------------------------------------------------
 * 24h change. It needs the same positions valued 24 hours ago, and nothing in
 * the API carries that — not the account response, not the market one. So the
 * tile renders an em dash and says why, in the tile, rather than being quietly
 * dropped from a spec that asks for it or filled with a zero.
 *
 * §279 is the rule and it cuts both ways here: a placeholder standing in for a
 * figure is forbidden, and so is a page that hides a figure it owes.
 *
 * EVERY NUMBER NEEDS AN ADDRESS
 * -----------------------------
 * Without a connected wallet there is nothing to show, and the disconnected
 * state renders the real structure with em dashes rather than zeros. "$0.00"
 * shown to someone holding a position is not an empty state, it is a wrong one,
 * and it is the kind of wrong a user acts on.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import {
  getAccount,
  getCreator,
  isOk,
  type AccountResponse,
  type CreatorResponse,
} from "../../lib/api.ts";
import { formatFixed, formatQuoteCompact, truncateAddress } from "../../lib/format.ts";
import { useWallet } from "../../lib/wallet.ts";
import { FreshnessBadge } from "../../components/Freshness.tsx";
import type { MarketStatus } from "../../components/GraduationProgress.tsx";
import type { FreshnessEnvelope } from "@sent/realtime";

import styles from "./account.module.css";

/** Quantities cross the wire as decimal strings (§424). */
function big(value: string | undefined): bigint {
  return value !== undefined && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function statusOf(status: string): MarketStatus {
  return status === "GRADUATED" || status === "GRADUATING" ? status : "PRE_GRAD";
}

/** §228: Graduating and Graduated, never "migrated". */
const LABEL: Record<MarketStatus, string> = {
  PRE_GRAD: "On the curve",
  GRADUATING: "Graduating",
  GRADUATED: "Graduated",
};

export default function AccountPage(): JSX.Element {
  const wallet = useWallet();
  const address = wallet.address;

  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [creator, setCreator] = useState<CreatorResponse | null>(null);
  const [freshness, setFreshness] = useState<FreshnessEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Two requests, in parallel.
   *
   * Positions and Stockback come from the account read; creator earnings come
   * from the creator read, because a creator's fees are owed to an address by
   * the vault rather than held as a position. §222 wants both figures on this
   * page, and sequencing them would stack two latencies for no reason.
   *
   * They fail independently. Somebody who has never launched anything still has
   * holdings worth showing, so a creator read that errors must not blank the
   * portfolio.
   */
  const load = useCallback(async (who: string, signal: AbortSignal): Promise<void> => {
    setLoading(true);
    setError(null);

    const [accountResult, creatorResult] = await Promise.all([
      getAccount(who, { signal }).catch(() => null),
      getCreator(who, { signal }).catch(() => null),
    ]);

    if (signal.aborted) return;

    if (accountResult === null) {
      setAccount(null);
      setError("Account data is reconnecting. Your funds and positions are unchanged.");
    } else {
      // The envelope is kept whether or not the body succeeded. §211: a page
      // that cannot say how old its numbers are cannot show them honestly.
      setFreshness(accountResult.freshness);

      if (isOk(accountResult)) {
        setAccount(accountResult.data);
      } else {
        setAccount(null);
        setError(accountResult.message);
      }
    }

    setCreator(creatorResult !== null && isOk(creatorResult) ? creatorResult.data : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (address === null) {
      setAccount(null);
      setCreator(null);
      return;
    }

    const controller = new AbortController();
    void load(address, controller.signal);
    return () => controller.abort();
  }, [address, load]);

  const connected = address !== null;

  /*
   * Creator earnings, summed across assets.
   *
   * `accrued` is one row per asset because a creator can be paid in several
   * xStocks, and the API refuses to add them — they are different things. This
   * tile sums them anyway to give §222 its headline figure, and the earnings
   * section below breaks the sum back out per asset so the composition is never
   * only implied.
   */
  const creatorEarned = (creator?.accrued ?? []).reduce((sum, row) => sum + big(row.amount), 0n);
  const creatorClaimable = (creator?.claimable ?? []).reduce(
    (sum, row) => sum + big(row.amount),
    0n,
  );

  return (
    <div className={`${styles.page} container`} data-mode="trading">
      <header className={styles.head}>
        <h1 className={`${styles.title} m-primary`}>Account</h1>
        <p className={`${styles.subtitle} m-secondary`}>
          Your positions, launches and earnings across every SENT market.
        </p>
        {connected && freshness !== null && <FreshnessBadge envelope={freshness} />}
      </header>

      <section className={styles.metrics} aria-label="Portfolio summary">
        <Metric
          label="Portfolio value"
          detail="Marked at the curve price of every position you hold."
          value={
            account === null ? null : `${formatQuoteCompact(big(account.portfolioValue.value))}`
          }
        />
        <Metric
          label="24h change"
          // Not served, and not invented. Nothing in the API carries these same
          // positions valued 24 hours ago, and a zero here would be a claim.
          detail="Needs these positions valued 24 hours ago, which the API does not serve yet."
          value={null}
        />
        <Metric
          label="Creator earnings"
          detail="Your 65% of the core fee, across every market you launched."
          value={creator === null ? null : formatQuoteCompact(creatorEarned)}
        />
        <Metric
          label="Claimable now"
          detail="Settled and withdrawable. Separate from what is still accruing."
          value={
            account === null && creator === null
              ? null
              : formatQuoteCompact(big(account?.totalClaimable) + creatorClaimable)
          }
        />
      </section>

      {!connected && (
        <div className={`${styles.connect} m-secondary`} role="status">
          <p className={styles.connectTitle}>Connect a wallet to see your positions</p>
          <p className={styles.connectBody}>
            Everything here is read from the chain against one address. SENT never
            custodies anything, so there is no account to create and nothing to sign up
            for — connecting reveals nothing to SENT that the chain does not already show.
          </p>
          {wallet.available ? (
            <button
              type="button"
              className={styles.connectCta}
              onClick={() => void wallet.connect()}
              disabled={wallet.connecting}
            >
              {wallet.connecting ? "Check your wallet" : "Connect wallet"}
            </button>
          ) : (
            <p className={styles.connectBody}>
              No wallet was found in this browser. Install one, then reload this page.
            </p>
          )}
        </div>
      )}

      {connected && loading && account === null && error === null && (
        <p className={styles.state}>Reading your positions from the chain…</p>
      )}

      {error !== null && <p className={styles.error}>{error}</p>}

      {connected && account !== null && (
        <div className={styles.sections}>
          <section className={`${styles.section} m-secondary`}>
            <h2 className={styles.sectionTitle}>Holdings</h2>
            <p className={styles.sectionBody}>
              Every market you hold a position in, marked at its current curve price. A
              mark is not what a sale would return — selling moves the curve down as it
              goes.
            </p>

            {account.holdings.length === 0 ? (
              <div className={styles.sectionEmpty}>
                No positions yet. Anything you buy appears here.
              </div>
            ) : (
              <ul className={styles.rows}>
                {account.holdings.map((holding) => (
                  <li key={holding.token} className={styles.row}>
                    <Link href={`/t/${holding.token}`} className={styles.rowMain}>
                      <span className={styles.rowSymbol}>{holding.symbol}</span>
                      <span className={styles.rowName}>{holding.name}</span>
                    </Link>

                    <div className={styles.rowFigures}>
                      <span className={`${styles.rowBalance} num`}>
                        {formatFixed(big(holding.balance), 18, { places: 2, grouped: true })}
                      </span>
                      <span className={styles.rowValue}>
                        {formatQuoteCompact(big(holding.value.value))} {holding.quoteSymbol}
                      </span>
                    </div>

                    {/*
                      The status, not a progress bar. `AccountHolding` carries
                      no graduation progress, and rendering a bar at 0% would
                      state that every position is at the start of its curve —
                      a number nobody read, presented as one somebody did.
                    */}
                    <span className={styles.rowStatus} data-status={statusOf(holding.status)}>
                      {LABEL[statusOf(holding.status)]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${styles.section} m-secondary`}>
            <h2 className={styles.sectionTitle}>Earnings</h2>
            <p className={styles.sectionBody}>
              Stockback and creator fees, each shown separately rather than as one total —
              they are paid by different contracts and claimed differently.
            </p>

            {account.stockback.length === 0 && (creator?.accrued.length ?? 0) === 0 ? (
              <div className={styles.sectionEmpty}>
                Nothing accrued yet. Stockback accrues as you hold; creator fees accrue as
                your markets trade.
              </div>
            ) : (
              <ul className={styles.rows}>
                {account.stockback.map((reward) => (
                  <li key={reward.token} className={styles.row}>
                    <span className={styles.rowSymbol}>{reward.symbol}</span>
                    <span className={styles.rowName}>Stockback in {reward.rewardSymbol}</span>
                    <span className={`${styles.rowBalance} num`}>
                      {formatQuoteCompact(big(reward.claimable))} {reward.rewardSymbol}
                    </span>
                  </li>
                ))}

                {(creator?.accrued ?? []).map((row) => (
                  <li key={`creator-${row.asset}`} className={styles.row}>
                    <span className={styles.rowSymbol}>{row.symbol}</span>
                    <span className={styles.rowName}>Creator fees</span>
                    <span className={`${styles.rowBalance} num`}>
                      {formatQuoteCompact(big(row.amount))} {row.symbol}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <Link href="/creator" className={styles.sectionCta}>
              Claim on the creator page
            </Link>
          </section>

          <section className={`${styles.section} m-secondary`}>
            <h2 className={styles.sectionTitle}>Activity</h2>
            <p className={styles.sectionBody}>Your claims, newest first.</p>

            {account.claims.length === 0 ? (
              <div className={styles.sectionEmpty}>No claims yet.</div>
            ) : (
              <ul className={styles.rows}>
                {account.claims.map((claim) => (
                  <li key={`${claim.token}-${claim.blockNumber}`} className={styles.row}>
                    <span className={styles.rowSymbol}>{claim.symbol}</span>
                    <span className={styles.rowName}>Claimed</span>
                    <span className={`${styles.rowBalance} num`}>
                      {formatQuoteCompact(big(claim.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${styles.section} m-secondary`}>
            <h2 className={styles.sectionTitle}>My launches</h2>
            <p className={styles.sectionBody}>
              {account.launchCount === 0
                ? "You have not launched a market yet."
                : `${account.launchCount} market${account.launchCount === 1 ? "" : "s"} launched from ${truncateAddress(account.account)}.`}
            </p>
            <Link href={account.launchCount === 0 ? "/create" : "/creator"} className={styles.sectionCta}>
              {account.launchCount === 0 ? "Launch a token" : "Open the creator page"}
            </Link>
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * One headline figure.
 *
 * A null value renders an em dash, never a zero. §222 wants these figures and
 * §279 forbids standing in for one that has not been read — a dash says "not
 * known", and 0.00 says "you have none", and only one of those is honest when
 * the read has not happened.
 */
function Metric({
  label,
  detail,
  value,
}: {
  label: string;
  detail: string;
  value: string | null;
}): JSX.Element {
  return (
    <div className={`${styles.metric} m-ambient`}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`${styles.metricValue} num`}>{value ?? "—"}</span>
      <span className={styles.metricDetail}>{detail}</span>
    </div>
  );
}

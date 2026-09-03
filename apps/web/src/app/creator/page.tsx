"use client";

/**
 * SENT — Creator Control Center (§221).
 *
 * §221's priority order, top to bottom: creator earnings, claimable fees,
 * launches, market status, graduation progress, volume and activity, quick
 * actions. It is a trading cockpit for someone who launched a market, not an
 * admin CMS.
 *
 * NO ADMIN SURFACE, BECAUSE THERE IS NOTHING TO ADMINISTER
 * --------------------------------------------------------
 * §221 states it plainly: no token admin powers are exposed because none should
 * exist. There is no pause, no mint, no blacklist, no fee change, no metadata
 * edit. A creator here has exactly two powers — launch another market, and
 * withdraw the fees they earned — and both are things any wallet could do on
 * their own behalf.
 *
 * TWO FEE FIGURES, NEVER ONE
 * --------------------------
 * "Claimable now" comes from the vault; "earned all time" comes from the
 * projection. They differ the moment a creator claims once. Collapsing them into
 * a single number would either hide earnings or put a claim button over an
 * amount the vault refuses to pay, and the second failure costs gas to discover.
 *
 * THE CLAIM IS AN INTENT, NOT CALLDATA BUILT HERE
 * -----------------------------------------------
 * §694 again: the amount rendered and the bytes signed come from the same
 * object. This page calls `buildClaimCreatorFeesIntent` and renders its review
 * rows verbatim — it does not encode a function selector, and it does not
 * compute a figure to display next to one.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { buildClaimCreatorFeesIntent } from "@sent/sdk";

import { getCreator, isOk, type CreatorResponse } from "../../lib/api.ts";
import { formatAmount, formatCompact, truncateAddress } from "../../lib/format.ts";
import { useWallet, CHAIN_ID } from "../../lib/wallet.ts";
import { GraduationProgress } from "../../components/GraduationProgress.tsx";
import { FreshnessBadge } from "../../components/Freshness.tsx";
import type { FreshnessEnvelope } from "@sent/realtime";

import styles from "./creator.module.css";

/** Quantities cross the wire as decimal strings (§424). */
function big(value: string | undefined): bigint {
  return value === undefined ? 0n : BigInt(value);
}

export default function CreatorPage(): JSX.Element {
  const wallet = useWallet();
  const address = wallet.address;

  const [data, setData] = useState<CreatorResponse | null>(null);
  const [freshness, setFreshness] = useState<FreshnessEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (who: string, signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const result = await getCreator(who, signal === undefined ? {} : { signal });

      // The envelope is kept whether or not the body succeeded. §211: a page
      // that cannot say how old its numbers are cannot show them honestly.
      setFreshness(result.freshness);

      if (isOk(result)) {
        setData(result.data);
      } else {
        setError(result.message);
      }
    } catch (caught) {
      if (signal?.aborted === true) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Creator data is unavailable. Your fees are unaffected.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (address === null) {
      setData(null);
      return;
    }

    const controller = new AbortController();
    void load(address, controller.signal);
    return () => controller.abort();
  }, [address, load]);

  return (
    <div className={`${styles.page} container`} data-mode="trading">
      <header className={styles.head}>
        <div className={styles.headMain}>
          <h1 className={styles.title}>Creator</h1>
          <p className={styles.subtitle}>
            Your markets, what they have earned, and what you can withdraw right now.
          </p>
        </div>
        {freshness !== null && <FreshnessBadge envelope={freshness} />}
      </header>

      {address === null ? (
        <Disconnected wallet={wallet} />
      ) : (
        <>
          <Earnings data={data} loading={loading} />

          <ClaimPanel
            data={data}
            address={address}
            onClaimed={() => void load(address)}
          />

          <Launches data={data} loading={loading} />

          <QuickActions />
        </>
      )}

      {error !== null && (
        <p className={styles.error} role="status">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Disconnected({ wallet }: { wallet: ReturnType<typeof useWallet> }): JSX.Element {
  return (
    <div className={styles.connect} role="status">
      <p className={styles.connectTitle}>Connect the wallet that launched your markets</p>
      <p className={styles.connectBody}>
        Nothing here is stored against an account — the page reads your launches from the
        chain and your claimable balance from the fee vault. There is no sign-up, and
        connecting reveals nothing to SENT that the chain does not already show.
      </p>

      {!wallet.available ? (
        <p className={styles.connectNote}>
          No wallet was found in this browser. Install one, then reload this page.
        </p>
      ) : (
        <button
          type="button"
          className={styles.connectCta}
          onClick={() => void wallet.connect()}
          disabled={wallet.connecting}
        >
          {wallet.connecting ? "Check your wallet" : "Connect wallet"}
        </button>
      )}

      {wallet.error !== null && <p className={styles.error}>{wallet.error}</p>}
    </div>
  );
}

/**
 * §221's first two priorities, side by side and clearly distinct.
 *
 * Both are sums across assets, which is only meaningful because every market is
 * quoted in an xStock and a creator's markets are usually few — so each asset is
 * also listed by name underneath rather than hidden inside a total.
 */
function Earnings({
  data,
  loading,
}: {
  data: CreatorResponse | null;
  loading: boolean;
}): JSX.Element {
  const claimable = data?.claimable ?? [];
  const accrued = data?.accrued ?? [];

  /*
   * The vault could not be read.
   *
   * The API clears the vault address rather than returning a partial list, so
   * this is the difference between "you have nothing to claim" and "we could not
   * ask". Rendering both as 0 would be a wrong figure about money, and the
   * creator would have no way to tell which one they were looking at.
   */
  const claimUnknown = data !== null && data.feeVault === null && data.accrued.length > 0;

  return (
    <section className={styles.metrics} aria-label="Creator earnings">
      <div className={styles.metric}>
        <span className={styles.metricLabel}>Claimable now</span>
        <span className={`${styles.metricValue} num`}>
          {/* An em dash while unknown, never a zero: "0" to a creator who has
              earned something is a wrong figure, not an empty one. */}
          {(loading && data === null) || claimUnknown ? "—" : assetTotal(claimable)}
        </span>
        <span className={styles.metricDetail}>
          Read from the fee vault. This is what a claim pays.
        </span>
        {claimUnknown ? (
          <span className={styles.assetsEmpty}>
            The vault could not be reached. Your balance is untouched.
          </span>
        ) : (
          <AssetList items={claimable} empty="Nothing outstanding." />
        )}
      </div>

      <div className={styles.metric}>
        <span className={styles.metricLabel}>Earned all time</span>
        <span className={`${styles.metricValue} num`}>
          {loading && data === null ? "—" : assetTotal(accrued)}
        </span>
        <span className={styles.metricDetail}>
          Your 65% of the core fee, including what you have already withdrawn.
        </span>
        <AssetList items={accrued} empty="No fees yet." />
      </div>

      <div className={styles.metric}>
        <span className={styles.metricLabel}>Launches</span>
        <span className={`${styles.metricValue} num`}>
          {data === null ? "—" : data.launches.length}
        </span>
        <span className={styles.metricDetail}>
          Markets you created. SENT keeps no allocation in any of them.
        </span>
      </div>

      <div className={styles.metric}>
        <span className={styles.metricLabel}>Graduated</span>
        <span className={`${styles.metricValue} num`}>
          {data === null
            ? "—"
            : data.launches.filter((l) => l.status === "GRADUATED").length}
        </span>
        <span className={styles.metricDetail}>
          Curve complete, liquidity permanently locked in the pool.
        </span>
      </div>
    </section>
  );
}

/** A per-asset breakdown, so a total is never the only thing shown. */
function AssetList({
  items,
  empty,
}: {
  items: readonly { asset: string; symbol: string; amount: string }[];
  empty: string;
}): JSX.Element {
  if (items.length === 0) {
    return <span className={styles.assetsEmpty}>{empty}</span>;
  }

  return (
    <ul className={styles.assets}>
      {items.map((item) => (
        <li key={item.asset} className={styles.asset}>
          <span className={`${styles.assetAmount} num`}>
            {formatAmount(BigInt(item.amount), 18)}
          </span>
          <span className={styles.assetSymbol}>{item.symbol}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Sum across assets, compactly.
 *
 * Every quantity in the projection is normalized to eighteen decimals, so these
 * add up. That was not true until the indexer normalized the vault's raw
 * amounts — before it did, adding a six-decimal figure to an eighteen-decimal
 * one would have produced a number a trillion times too small.
 */
function assetTotal(
  items: readonly { asset: string; symbol: string; amount: string }[],
): string {
  if (items.length === 0) return "0";

  const total = items.reduce((sum, item) => sum + big(item.amount), 0n);

  // One asset is the common case, and it can be named. Several cannot be summed
  // into a single symbol, so the figure stands alone and the list below names
  // each — rather than inventing a currency to express the total in.
  return items.length === 1 && items[0] !== undefined
    ? `${formatCompact(total, 18)} ${items[0].symbol}`
    : formatCompact(total, 18);
}

/**
 * The claim.
 *
 * One button per asset, because `claimCreatorFees` takes an asset and pays that
 * balance — a single "claim all" button would be one transaction per asset with
 * one label, and a partial failure would have no honest way to report itself.
 */
function ClaimPanel({
  data,
  address,
  onClaimed,
}: {
  data: CreatorResponse | null;
  address: `0x${string}`;
  onClaimed: () => void;
}): JSX.Element | null {
  const wallet = useWallet();
  const [pending, setPending] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const claimable = data?.claimable ?? [];
  const feeVault = data?.feeVault ?? null;

  const claim = useCallback(
    async (asset: string, symbol: string, amount: string) => {
      if (feeVault === null) return;

      setPending(asset);
      setFailed(null);
      setSent(null);

      try {
        /*
         * Built from the vault the API read the balance from, not from a vault
         * address this client holds. The figure and the target then cannot
         * disagree — a client with its own address could show one contract's
         * balance over a button that calls another.
         */
        const intent = buildClaimCreatorFeesIntent({
          chainId: CHAIN_ID,
          feeVault: feeVault as `0x${string}`,
          asset: asset as `0x${string}`,
          to: address,
          amount: BigInt(amount),
          decimals: 18,
          symbol,
        });

        const hash = await wallet.send({
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
        });

        setSent(hash);
        // Re-read rather than subtracting locally. The vault is the authority on
        // what is left, and a locally adjusted balance is how a page starts
        // disagreeing with the chain it is describing (§138).
        onClaimed();
      } catch (caught) {
        setFailed(
          caught instanceof Error
            ? caught.message
            : "The claim was not sent. Nothing was signed and nothing moved.",
        );
      } finally {
        setPending(null);
      }
    },
    [feeVault, address, wallet, onClaimed],
  );

  if (data === null) return null;

  if (claimable.length === 0) {
    return (
      <section className={styles.claim} aria-label="Claim fees">
        <h2 className={styles.sectionTitle}>Claim fees</h2>
        <p className={styles.claimEmpty}>
          {data.feeVault === null && data.accrued.length > 0
            ? "The fee vault could not be reached, so what is claimable is unknown right now. Nothing has moved."
            : data.accrued.length === 0
              ? "Fees appear here as your markets trade. You earn 65% of every 1% core fee."
              : "Everything earned so far has been withdrawn."}
        </p>
      </section>
    );
  }

  return (
    <section className={styles.claim} aria-label="Claim fees">
      <h2 className={styles.sectionTitle}>Claim fees</h2>

      <ul className={styles.claimList}>
        {claimable.map((item) => (
          <li key={item.asset} className={styles.claimRow}>
            <div className={styles.claimAmount}>
              <span className={`${styles.claimValue} num`}>
                {formatAmount(BigInt(item.amount), 18)}
              </span>
              <span className={styles.claimSymbol}>{item.symbol}</span>
            </div>

            {wallet.wrongChain ? (
              <button
                type="button"
                className={styles.claimButton}
                onClick={() => void wallet.switchChain()}
              >
                Switch network
              </button>
            ) : (
              <button
                type="button"
                className={styles.claimButton}
                onClick={() => void claim(item.asset, item.symbol, item.amount)}
                disabled={pending !== null || data.feeVault === null}
              >
                {pending === item.asset ? "Confirm in your wallet" : "Claim"}
              </button>
            )}
          </li>
        ))}
      </ul>

      {data.feeVault === null && (
        <p className={styles.claimNote}>
          The fee vault could not be reached, so claiming is unavailable right now. Your
          balance is untouched and still on-chain.
        </p>
      )}

      {sent !== null && (
        <p className={styles.claimNote}>Submitted — {truncateAddress(sent, 10, 8)}.</p>
      )}
      {failed !== null && <p className={styles.error}>{failed}</p>}
    </section>
  );
}

/** §221: launches, market status, graduation progress, activity. */
function Launches({
  data,
  loading,
}: {
  data: CreatorResponse | null;
  loading: boolean;
}): JSX.Element {
  if (data === null) {
    return (
      <section className={styles.launches} aria-label="Your launches">
        <h2 className={styles.sectionTitle}>Your launches</h2>
        <div className={styles.launchesEmpty}>
          {loading ? "Reading your launches…" : "Nothing loaded yet."}
        </div>
      </section>
    );
  }

  if (data.launches.length === 0) {
    return (
      <section className={styles.launches} aria-label="Your launches">
        <h2 className={styles.sectionTitle}>Your launches</h2>
        <div className={styles.launchesEmpty}>
          You have not launched a market yet. Launching is permissionless and takes one
          transaction.
          <Link href="/create" className={styles.launchesCta}>
            Launch a token
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.launches} aria-label="Your launches">
      <h2 className={styles.sectionTitle}>Your launches</h2>

      <ul className={styles.launchList}>
        {data.launches.map((launch) => (
          <li key={launch.token} className={styles.launch}>
            <div className={styles.launchHead}>
              <Link href={`/t/${launch.token}`} className={styles.launchName}>
                <span className={styles.launchSymbol}>{launch.symbol}</span>
                <span className={styles.launchTitle}>{launch.name}</span>
              </Link>
              <span className={styles.launchQuote}>/ {launch.quoteSymbol}</span>
            </div>

            <GraduationProgress
              progressBps={launch.graduationProgressBps.value}
              status={launch.status === "GRADUATED" ? "GRADUATED" : "PRE_GRAD"}
              quoteSymbol={launch.quoteSymbol}
              size="sm"
            />

            <div className={styles.launchMeta}>
              <span className={styles.launchStat}>
                <span className={`${styles.launchStatValue} num`}>
                  {launch.holderCount.value}
                </span>
                <span className={styles.launchStatLabel}>holders</span>
              </span>

              <Link href={`/t/${launch.token}`} className={styles.launchAction}>
                Open terminal
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** §221's primary actions. Launch and terminal are real; nothing else is invented. */
function QuickActions(): JSX.Element {
  return (
    <section className={styles.actions} aria-label="Quick actions">
      <Link href="/create" className={styles.actionPrimary}>
        Launch a new token
      </Link>
      <Link href="/explore" className={styles.action}>
        Explore markets
      </Link>
    </section>
  );
}

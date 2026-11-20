/**
 * SENT — homepage (§213).
 *
 * Priority, in the order §213 gives: brand, live market discovery, the
 * trending/new/near-graduation split, market pulse, the create CTA, supporting
 * stats.
 *
 * WHAT §213 FORBIDS
 * -----------------
 * No intro splash that must finish before interaction. There is no gate, no
 * loader over the page, and no animation that owns the first paint — the markets
 * are server-rendered and present before any script runs.
 *
 * A user can reach a market immediately: the discovery rail is above the fold on
 * desktop and one scroll away on mobile, and nothing animates into place that
 * was not already there.
 */

import Link from "next/link";

import { getLaunchConfig, listMarkets, isOk } from "../lib/api.ts";
import { TokenCard } from "../components/TokenCard.tsx";
import { FreshnessBadge } from "../components/Freshness.tsx";
import { Logo } from "../components/Logo.tsx";
import { MarketPulse } from "../components/MarketPulse.tsx";
import { PlatformStats } from "../components/PlatformStats.tsx";
import { isActionableFreshness } from "../lib/freshness.ts";

import styles from "./page.module.css";
import type { JSX } from "react";

// The homepage is public and identical for everyone, so it is cached briefly
// rather than rendered per request. Six seconds is short enough that a new
// launch appears promptly and long enough to absorb a burst.
export const revalidate = 6;

export default async function HomePage(): Promise<JSX.Element> {
  // Three rails, one round trip each. Fetched in parallel: sequentially they
  // would stack three API latencies into the server render.
  /*
   * §49's rails, all six of them.
   *
   * Three were built and three were not: recently graduated, top volume and top
   * gainers. The API has served every one of these sorts since it was written —
   * the homepage was asking for a subset of what it already had.
   *
   * `trending` used VOLUME because TRENDING was not wired through. It is now,
   * and the two are different questions: trending is movement, volume is size,
   * and §49 lists them separately because a market can be either without being
   * the other.
   *
   * Six round trips in parallel. Sequentially they would stack six API
   * latencies into one server render.
   */
  const [trending, fresh, nearGraduation, recentlyGraduated, topVolume, gainers, launchConfig] =
    await Promise.all([
      listMarkets({ sort: "TRENDING", limit: 6, status: "PRE_GRAD" }, { revalidateSeconds: 6 })
        .catch(() => null),
      listMarkets({ sort: "NEWEST", limit: 6 }, { revalidateSeconds: 6 }).catch(() => null),
      listMarkets({ sort: "PROGRESS", limit: 6, status: "PRE_GRAD" }, { revalidateSeconds: 6 })
        .catch(() => null),
      listMarkets(
        { sort: "RECENTLY_GRADUATED", limit: 6, status: "GRADUATED" },
        { revalidateSeconds: 6 },
      ).catch(() => null),
      listMarkets({ sort: "VOLUME", limit: 6 }, { revalidateSeconds: 6 }).catch(() => null),
      listMarkets({ sort: "GAINERS", limit: 6, status: "PRE_GRAD" }, { revalidateSeconds: 6 })
        .catch(() => null),
      // Unlike discovery rails, a launch gate must never fall back to a cached
      // answer after the API or chain stops responding.
      getLaunchConfig().catch(() => null),
    ]);

  const launchConfigUsable =
    launchConfig !== null &&
    isOk(launchConfig) &&
    isActionableFreshness(launchConfig.freshness);
  const canLaunch = launchConfigUsable && launchConfig.data.ready;
  const stockbackBlocksLaunch =
    launchConfigUsable &&
    launchConfig !== null &&
    isOk(launchConfig) &&
    launchConfig.data.graduationRouter !== null &&
    launchConfig.data.launchable.some((asset) => asset.usdPriceWad !== null) &&
    !launchConfig.data.stockback.ready;
  const launchableAssets =
    canLaunch && launchConfig !== null && isOk(launchConfig)
      ? launchConfig.data.launchable.filter((asset) => asset.usdPriceWad !== null)
      : [];
  const launchStatus =
    !launchConfigUsable
      ? "unknown"
      : canLaunch
        ? "available"
        : "unavailable";

  return (
    <div data-mode="experience">
      <section className={styles.hero}>
        {/* Ambient only, and behind the content in the stacking order. It cannot
            intercept a click, and it is the first thing dropped under
            prefers-reduced-motion. */}
        <div className={styles.heroGlow} aria-hidden="true" />

        <div className={`${styles.heroInner} container`}>
          <Logo size={72} glow />

          <h1 className={`${styles.title} m-primary`}>
            Launch. Pair.
            <br />
            <span className={styles.titleAccent}>Create market.</span>
          </h1>

          <p className={`${styles.lede} m-secondary`}>
            Launch fixed-supply tokens against WHYPE on HyperEVM. Verified stock-backed quote
            assets can be added as they clear their own checks. Launch access depends on live
            oracle, asset and graduation requirements shown here.
          </p>

          <section className={styles.launchStatus} data-state={launchStatus} aria-label="Live launch availability">
            <div className={styles.launchStatusHeading}>
              <span className={styles.statusDot} aria-hidden="true" />
              <strong>
                {launchStatus === "available"
                  ? "Launches available"
                  : launchStatus === "unavailable"
                    ? "Launches not available yet"
                    : "Launch availability could not be checked"}
              </strong>
              {launchConfig !== null && isOk(launchConfig) && (
                <FreshnessBadge envelope={launchConfig.freshness} />
              )}
            </div>
            <p className={styles.launchStatusDetail}>
              {launchStatus === "available"
                ? `Live price and graduation checks pass for ${launchableAssets
                    .slice(0, 4)
                    .map((asset) => asset.symbol)
                    .join(", ")}${launchableAssets.length > 4 ? ` and ${launchableAssets.length - 4} more` : ""}. Review the launch fee and current price in the create flow before signing.`
                : launchStatus === "unavailable"
                  ? stockbackBlocksLaunch && launchConfig !== null && isOk(launchConfig)
                    ? launchConfig.data.stockback.guardian === null
                            ? "Launches are held while governance configures the Stockback guardian. Rewards must be ready before a public market can open."
                            : launchConfig.data.stockback.claimsPaused
                              ? "Launches are held because Stockback claims are paused. Existing markets, if any, remain available to explore."
                              : !launchConfig.data.stockback.vaultConfigurationReady
                                ? `Launches are held until Stockback's attestor quorum is configured (${launchConfig.data.stockback.attestorCount} attestors, quorum ${launchConfig.data.stockback.quorum}).`
                                : "Launches are held while the reward vault configuration is checked."
                    : "No market can be launched right now. SENT will not submit a launch transaction while its live requirements are missing. Existing markets, if any, remain available to explore."
                  : launchConfig !== null &&
                      isOk(launchConfig) &&
                      !isActionableFreshness(launchConfig.freshness)
                    ? `Launch requirements are ${launchConfig.freshness.state.toLowerCase()}. Refresh when the live chain view recovers; this status does not approve a launch.`
                    : "The live launch configuration is unavailable. Check again later; do not treat a missing status as launch approval."}
            </p>
          </section>

          {launchStatus === "available" &&
            launchConfig !== null &&
            isOk(launchConfig) &&
            (!launchConfig.data.stockback.factoryGuardMarkerPresent ||
              !launchConfig.data.stockback.vaultReadinessCheckSupported) && (
              <p className={styles.launchStatusDetail} role="status">
                MVP compatibility: this deployed factory does not recheck Stockback readiness
                inside the launch transaction. SENT checks the live guardian, quorum and pause
                state before enabling launch; a guarded factory deployment is still required for
                the full on-chain check.
              </p>
            )}

          <div className={`${styles.heroActions} m-secondary`}>
            <Link href="/explore" className={styles.primaryCta}>
              Explore markets
            </Link>
            <Link href="/create" className={styles.secondaryCta}>
              {canLaunch ? "Launch a token" : "View launch requirements"}
            </Link>
          </div>

          <p className={styles.termsLabel}>Protocol terms for enabled markets</p>
          <dl className={styles.facts}>
            <Fact term="Supply" detail="Fixed at launch. No mint, no burn." value="1B" />
            <Fact term="Creator allocation" detail="No premine. None." value="0%" />
            <Fact
              term="Core trading fee"
              detail="When enabled: 65% creator, 35% platform. Earned only from live trades."
              value="1%"
            />
            <Fact
              term="Stockback"
              detail="When rewards are active: paid in the paired asset after attestation and activation."
              value="+1% / +2%"
            />
          </dl>
        </div>
      </section>

      <div className="container">
        <Rail
          title="Trending"
          description="Moving fastest right now."
          href="/explore?sort=TRENDING"
          result={trending}
        />
        <Rail
          title="Near graduation"
          description="Closest to a permanently locked pool."
          href="/explore?sort=PROGRESS"
          result={nearGraduation}
        />
        <Rail
          title="Newly launched"
          description="Fresh markets, newest first."
          href="/explore?sort=NEWEST"
          result={fresh}
        />

        <Rail
          title="Top gainers"
          description="Furthest along their curve since launch."
          href="/explore?sort=GAINERS"
          result={gainers}
        />

        <Rail
          title="Top volume"
          description="Most traded, graduated or not."
          href="/explore?sort=VOLUME"
          result={topVolume}
        />

        <Rail
          title="Recently graduated"
          description="Curves closed, liquidity locked permanently."
          href="/explore?sort=RECENTLY_GRADUATED"
          result={recentlyGraduated}
        />

        {/*
          §213 puts market pulse between the rails and the create CTA. Volume
          appears here and nowhere else on this page because pulse groups it by
          quote asset — the only shape in which it has a unit.
        */}
        <MarketPulse />

        {/*
          §213's last priority, and the page had none. Counts only — the API's
          volume and fee totals are summed across quote assets with no
          conversion, so they carry no unit; see `PlatformStats` for why showing
          one anyway would be the vanity metric §168 rules out.
        */}
        <PlatformStats />
      </div>
    </div>
  );
}

function Fact({
  term,
  value,
  detail,
}: {
  term: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className={`${styles.fact} m-ambient`}>
      <dt className={styles.factTerm}>{term}</dt>
      <dd className={`${styles.factValue} num`}>{value}</dd>
      <dd className={styles.factDetail}>{detail}</dd>
    </div>
  );
}

/**
 * One discovery rail.
 *
 * Handles three states explicitly, because §40 requires empty, loading and error
 * states to be part of the design system rather than an afterthought — and
 * because a rail that renders nothing when the API is down looks identical to
 * one where no market qualifies.
 */
function Rail({
  title,
  description,
  href,
  result,
}: {
  title: string;
  description: string;
  href: string;
  result: Awaited<ReturnType<typeof listMarkets>> | null;
}): JSX.Element {
  const dataUnavailable =
    result === null ||
    (result !== null &&
      isOk(result) &&
      (result.freshness.state === "STALE" || result.freshness.state === "RECONNECTING"));

  return (
    <section className={styles.rail}>
      <header className={`${styles.railHead} m-secondary`}>
        <div>
          <h2 className={styles.railTitle}>{title}</h2>
          <p className={styles.railDescription}>{description}</p>
        </div>

        <div className={styles.railMeta}>
          {result !== null && <FreshnessBadge envelope={result.freshness} />}
          <Link href={href} className={styles.railLink}>
            View all
          </Link>
        </div>
      </header>

      {dataUnavailable ? (
        <p className={styles.state}>
          Market data is stale or reconnecting, so this rail is hidden until it refreshes.
        </p>
      ) : !isOk(result) ? (
        <p className={styles.state}>{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <p className={styles.state}>
          No markets here yet. The first launch will appear as soon as it is indexed.
        </p>
      ) : (
        <div className={styles.grid}>
          {result.data.items.map((item) => (
            <TokenCard key={item.token} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

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

import { listMarkets, isOk } from "../lib/api.ts";
import { TokenCard } from "../components/TokenCard.tsx";
import { FreshnessBadge } from "../components/Freshness.tsx";
import { Logo } from "../components/Logo.tsx";
import { MarketPulse } from "../components/MarketPulse.tsx";
import { PlatformStats } from "../components/PlatformStats.tsx";

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
  const [trending, fresh, nearGraduation, recentlyGraduated, topVolume, gainers] =
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
    ]);

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
            Permissionless fixed-supply launches on HyperEVM, quoted against official
            xStocks. One billion tokens, no creator allocation, no platform allocation —
            and liquidity that locks permanently when a market graduates.
          </p>

          <div className={`${styles.heroActions} m-secondary`}>
            <Link href="/explore" className={styles.primaryCta}>
              Explore markets
            </Link>
            <Link href="/create" className={styles.secondaryCta}>
              Launch a token
            </Link>
          </div>

          {/* The economics, stated plainly. These are LOCKED values, not
              marketing figures, so they are presented as facts rather than as
              claims that need qualifying. */}
          <dl className={styles.facts}>
            <Fact term="Supply" detail="Fixed at launch. No mint, no burn." value="1B" />
            <Fact term="Creator allocation" detail="No premine. None." value="0%" />
            <Fact term="Core trading fee" detail="65% creator, 35% platform." value="1%" />
            <Fact term="Stockback" detail="Paid in the paired xStock." value="+1% / +2%" />
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

      {result === null ? (
        <p className={styles.state}>
          Market data is reconnecting. Your funds and on-chain position are unchanged.
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

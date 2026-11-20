/**
 * SENT — explore (§214).
 *
 * Search, xStock filter, sort, discovery tabs across the top; cards below.
 *
 * §214 says the default sort must feel useful immediately, so it is NEWEST
 * rather than an empty state waiting for the user to choose. It also says no
 * watchlist, and there is none — not deferred, not hidden behind a flag.
 *
 * Sort and filter live in the URL rather than in component state. A market found
 * by sorting is a market that can be sent to someone else, and a back button
 * that loses the sort is the reason people stop using filters.
 */

import Link from "next/link";

import {
  listMarkets,
  getLaunchConfig,
  isOk,
  type ExploreSort,
  type ExploreStatus,
} from "../../lib/api.ts";
import { truncateAddress } from "../../lib/format.ts";
import { TokenCard } from "../../components/TokenCard.tsx";
import { FreshnessBadge } from "../../components/Freshness.tsx";
import { isActionableFreshness } from "../../lib/freshness.ts";

import styles from "./explore.module.css";
import type { JSX } from "react";

export const revalidate = 4;

export const metadata = { title: "Explore" };

/**
 * §50's sorts, in its order.
 *
 * The API has served all seven since it was written; four were exposed. The
 * three that were not — trending, gainers and recently graduated — are the ones
 * §50 names first, because they are what makes this a discovery tool rather
 * than a product catalogue.
 */
const SORTS: { value: ExploreSort; label: string }[] = [
  { value: "TRENDING", label: "Trending" },
  { value: "VOLUME", label: "Volume" },
  { value: "GAINERS", label: "Gainers" },
  { value: "NEWEST", label: "New" },
  { value: "PROGRESS", label: "Near graduation" },
  { value: "RECENTLY_GRADUATED", label: "Recently graduated" },
  { value: "HOLDERS", label: "Holders" },
];

const STATUSES: { value: ExploreStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "PRE_GRAD", label: "Pre-graduation" },
  { value: "GRADUATED", label: "Graduated" },
];

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const params = await searchParams;

  // Validated against the allowed set rather than cast into it. The value comes
  // from a URL anyone can edit, and a cast would hand an arbitrary string to the
  // API as a sort key.
  const sort = parseSort(params.sort);
  const status = parseStatus(params.status);
  const pair = parsePair(params.pair);

  /*
   * The pair list comes from the launch config, which reads the registry.
   *
   * §50 wants a filter per xStock and the only honest source for "which
   * xStocks exist" is the registry the factory consults — typing one in, or
   * deriving the list from whatever markets happen to be indexed, would both
   * drift from what a launch would accept.
   */
  const config = await getLaunchConfig().catch(() => null);
  const pairs =
    config !== null && isOk(config) && isActionableFreshness(config.freshness)
      ? config.data.launchable
      : [];

  const result = await listMarkets(
    {
      sort,
      limit: 48,
      ...(status !== "ALL" ? { status } : {}),
      ...(pair !== null ? { quoteAsset: pair } : {}),
    },
    { revalidateSeconds: 4 },
  ).catch(() => null);
  const marketDataUnavailable =
    result === null ||
    (result !== null &&
      isOk(result) &&
      (result.freshness.state === "STALE" || result.freshness.state === "RECONNECTING"));

  return (
    <div className="container" data-mode="experience">
      <header className={styles.head}>
        <div>
          <h1 className={`${styles.title} m-primary`}>Explore</h1>
          <p className={`${styles.subtitle} m-secondary`}>
            Every market launched through SENT, quoted against official xStocks.
          </p>
        </div>
        {result !== null && <FreshnessBadge envelope={result.freshness} />}
      </header>

      {/* Links rather than buttons: each filter state is a real, shareable URL,
          and a keyboard user gets browser history for free. */}
      <nav className={`${styles.filters} m-secondary`} aria-label="Market filters">
        <div className={styles.group} role="group" aria-label="Sort">
          {SORTS.map((option) => (
            <Link
              key={option.value}
              href={buildHref(option.value, status, pair)}
              className={sort === option.value ? styles.chipActive : styles.chip}
              aria-current={sort === option.value ? "true" : undefined}
            >
              {option.label}
            </Link>
          ))}
        </div>

        <div className={styles.group} role="group" aria-label="Status">
          {STATUSES.map((option) => (
            <Link
              key={option.value}
              href={buildHref(sort, option.value, pair)}
              className={status === option.value ? styles.chipActive : styles.chip}
              aria-current={status === option.value ? "true" : undefined}
            >
              {option.label}
            </Link>
          ))}
        </div>

        {/*
          §50's pair filter. Rendered only when there is more than one to choose
          between: a single-choice filter is a control that cannot change
          anything, and offering it implies the platform has variety it does not.
        */}
        {pairs.length > 1 && (
          <div className={styles.group} role="group" aria-label="xStock pair">
            <Link
              href={buildHref(sort, status, null)}
              className={pair === null ? styles.chipActive : styles.chip}
              aria-current={pair === null ? "true" : undefined}
            >
              All xStocks
            </Link>
            {pairs.map((asset) => (
              <Link
                key={asset.token}
                href={buildHref(sort, status, asset.token)}
                className={pair === asset.token ? styles.chipActive : styles.chip}
                aria-current={pair === asset.token ? "true" : undefined}
              >
                {asset.symbol === "" ? truncateAddress(asset.token) : asset.symbol}
              </Link>
            ))}
          </div>
        )}
      </nav>

      {marketDataUnavailable ? (
        <p className={styles.state}>
          Market data is stale or reconnecting, so results are hidden until they refresh.
        </p>
      ) : !isOk(result) ? (
        <p className={styles.state}>{result.message}</p>
      ) : result.data.items.length === 0 ? (
        <div className={`${styles.empty} m-ambient`}>
          <p className={styles.emptyTitle}>No markets match this view.</p>
          <p className={styles.emptyBody}>Try a different filter, or launch the first one.</p>
          <Link href="/create" className={styles.emptyCta}>
            Launch a token
          </Link>
        </div>
      ) : (
        <div className={styles.grid}>
          {result.data.items.map((item) => (
            <TokenCard key={item.token} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Every control is a link, so every combination is a URL (§50, §69).
 *
 * Changing one filter preserves the others: a sort that dropped the pair would
 * make the two controls fight, and §50 asks for the state to be deep-linkable —
 * which it only is if it round-trips.
 */
function buildHref(
  sort: ExploreSort,
  status: ExploreStatus | "ALL",
  pair: string | null,
): string {
  const params = new URLSearchParams({ sort });
  if (status !== "ALL") params.set("status", status);
  if (pair !== null) params.set("pair", pair);
  return `/explore?${params.toString()}`;
}

/** An address, or nothing. Never passed through unvalidated (§699). */
function parsePair(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && /^0x[0-9a-fA-F]{40}$/.test(candidate)
    ? candidate.toLowerCase()
    : null;
}

/** An unknown sort falls back to the default rather than erroring (§214). */
function parseSort(value: string | string[] | undefined): ExploreSort {
  const candidate = Array.isArray(value) ? value[0] : value;
  return SORTS.some((s) => s.value === candidate) ? (candidate as ExploreSort) : "NEWEST";
}

/** An unknown status filters nothing, rather than filtering everything away. */
function parseStatus(value: string | string[] | undefined): ExploreStatus | "ALL" {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "PRE_GRAD" || candidate === "GRADUATED" ? candidate : "ALL";
}

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

import { listMarkets, isOk, type ExploreSort, type ExploreStatus } from "../../lib/api.ts";
import { TokenCard } from "../../components/TokenCard.tsx";
import { FreshnessBadge } from "../../components/Freshness.tsx";

import styles from "./explore.module.css";
import type { JSX } from "react";

export const revalidate = 4;

export const metadata = { title: "Explore" };

const SORTS: { value: ExploreSort; label: string }[] = [
  { value: "NEWEST", label: "Newest" },
  { value: "PROGRESS", label: "Near graduation" },
  { value: "VOLUME", label: "Volume" },
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

  const result = await listMarkets(
    {
      sort,
      limit: 48,
      ...(status !== "ALL" ? { status } : {}),
    },
    { revalidateSeconds: 4 },
  ).catch(() => null);

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
              href={buildHref(option.value, status)}
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
              href={buildHref(sort, option.value)}
              className={status === option.value ? styles.chipActive : styles.chip}
              aria-current={status === option.value ? "true" : undefined}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </nav>

      {result === null ? (
        <p className={styles.state}>
          Market data is reconnecting. Your funds and on-chain position are unchanged.
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

function buildHref(sort: ExploreSort, status: ExploreStatus | "ALL"): string {
  const params = new URLSearchParams({ sort });
  if (status !== "ALL") params.set("status", status);
  return `/explore?${params.toString()}`;
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

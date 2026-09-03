/**
 * SENT — token terminal (§215, §216).
 *
 * Priority, in §215's order: identity and status, metrics, chart, buy/sell,
 * graduation progress, activity, holder context. The desktop layout follows
 * §216 — header across the top, chart dominant, trade panel to its right,
 * activity and market details beneath.
 *
 * TRADING MODE (§39.2)
 * --------------------
 * `data-mode="trading"` turns ambient glow off and shortens every transition.
 * §215 forbids cinematic scroll effects inside the active trading core and
 * requires price and status never to be obscured by a visual effect, so the
 * terminal shares the design system with the homepage and none of its theatre.
 *
 * WHAT THIS PAGE DOES NOT DO
 * --------------------------
 * It does not price a trade. §423 makes the chain the authority for quotes and
 * §694 requires that what a user reviews is byte-for-byte what they sign, so
 * the trade panel asks the API for a complete intent rather than computing a
 * number here. There is no fee arithmetic anywhere in this app — that mistake
 * has already been made once in this codebase, in the API, and was caught.
 */

import { notFound } from "next/navigation";

import { getMarket, getTape, isOk } from "../../../lib/api.ts";
import {
  formatCompact,
  formatFixed,
  placesFor,
  truncateAddress,
} from "../../../lib/format.ts";
import { FreshnessBadge } from "../../../components/Freshness.tsx";
import { GraduationProgress, type MarketStatus } from "../../../components/GraduationProgress.tsx";
import { TradePanel } from "../../../components/TradePanel.tsx";
import { ChartPanel } from "../../../components/ChartPanel.tsx";
import { LiveTape } from "../../../components/LiveTape.tsx";

import styles from "./terminal.module.css";
import type { JSX } from "react";

export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<{ title: string }> {
  const { token } = await params;
  const result = await getMarket(token).catch(() => null);

  if (result === null || !isOk(result)) return { title: "Market" };
  return { title: `${result.data.symbol} — ${result.data.name}` };
}

export default async function TerminalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<JSX.Element> {
  const { token } = await params;

  const [marketResult, tapeResult] = await Promise.all([
    getMarket(token).catch(() => null),
    getTape(token, 50).catch(() => null),
  ]);

  if (marketResult === null) {
    return (
      <div className="container">
        <p className={styles.state}>
          Market data is reconnecting. Your funds and on-chain position are unchanged.
        </p>
      </div>
    );
  }

  // A market that does not exist is a 404, not an error panel. An unknown token
  // and a broken API are different situations and must not look the same.
  if (!isOk(marketResult)) {
    if (marketResult.code === "MARKET_NOT_FOUND") notFound();

    return (
      <div className="container">
        <p className={styles.state}>{marketResult.message}</p>
      </div>
    );
  }

  const market = marketResult.data;
  const status = normaliseStatus(market.status);
  const decimals = market.quoteDecimals;

  const price = safeBigint(market.price.value);
  const collateral = safeBigint(market.curveCollateral.value);
  const holders = safeBigint(market.holderCount.value);
  const distributed = safeBigint(market.distributed.value);

  return (
    <div className={`${styles.page} container-wide`} data-mode="trading">
      {/* --- Header (§215: identity and status first) --------------------- */}
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.monogram} aria-hidden="true">
            {market.symbol.slice(0, 2).toUpperCase()}
          </span>

          <div>
            <div className={styles.nameRow}>
              <h1 className={styles.symbol}>{market.symbol}</h1>
              {/* Authenticity comes from the factory registry (§4). Nothing here
                  inspects the name or address to decide it. */}
              {market.authentic && (
                <span className={styles.verified} title="Launched through the SENT factory">
                  Official
                </span>
              )}
            </div>
            <p className={styles.name}>{market.name}</p>
          </div>
        </div>

        <div className={styles.headerMeta}>
          <span className={styles.pair}>
            Paired with <strong>{market.quoteSymbol}</strong>
          </span>
          <FreshnessBadge envelope={marketResult.freshness} />
        </div>
      </header>

      {/* --- Metrics ----------------------------------------------------- */}
      <section className={styles.metrics} aria-label="Market metrics">
        <Metric
          label="Price"
          value={
            price === null
              ? "—"
              : // Precision from the magnitude (§41), then padded to it so the
                // figure keeps a stable width as it ticks (§80). A fixed eight
                // places renders a sub-cent price as zeros.
                formatFixed(price, decimals, {
                  places: placesFor(price, decimals),
                  pad: true,
                  grouped: true,
                })
          }
          suffix={market.quoteSymbol}
          emphasis
        />
        <Metric
          label="Curve collateral"
          value={collateral === null ? "—" : formatCompact(collateral, decimals)}
          suffix={market.quoteSymbol}
        />
        <Metric
          label="Distributed"
          value={distributed === null ? "—" : formatCompact(distributed, 18)}
          suffix="tokens"
        />
        <Metric label="Holders" value={holders === null ? "—" : formatCompact(holders, 0)} />
      </section>

      {/* --- Chart + trade (§216) ---------------------------------------- */}
      <div className={styles.core}>
        <section className={styles.chart} aria-label="Price chart">
          <ChartPanel
            token={market.token}
            quoteSymbol={market.quoteSymbol}
            quoteDecimals={decimals}
            graduated={status === "GRADUATED"}
            graduatedAt={market.graduatedAt}
          />
        </section>

        <aside className={styles.trade} aria-label="Trade">
          <TradePanel
            token={market.token}
            market={market.market}
            quoteAsset={market.quoteAsset}
            symbol={market.symbol}
            quoteSymbol={market.quoteSymbol}
            quoteDecimals={decimals}
            status={status}
            freshness={marketResult.freshness}
          />
        </aside>
      </div>

      {/* --- Graduation --------------------------------------------------- */}
      <section className={styles.graduation} aria-label="Graduation">
        <GraduationProgress
          progressBps={market.graduationProgressBps.value}
          status={status}
          quoteSymbol={market.quoteSymbol}
          size="lg"
        />
      </section>

      {/* --- Activity + details ------------------------------------------ */}
      <div className={styles.lower}>
        <section className={styles.activity} aria-label="Recent trades">
          {/* Server-rendered rows, then live ones prepended over the socket. The
              tape is the surface where §22's "no manual refresh" is most
              visible, and the one where a silent gap is least acceptable. */}
          <LiveTape
            market={market.market}
            quoteDecimals={decimals}
            initial={tapeResult !== null && isOk(tapeResult) ? tapeResult.data : []}
          />
        </section>

        <section className={styles.details} aria-label="Market details">
          <h2 className={styles.sectionTitle}>Market details</h2>

          <dl className={styles.detailList}>
            <Detail term="Token" value={truncateAddress(market.token)} full={market.token} />
            <Detail term="Market" value={truncateAddress(market.market)} full={market.market} />
            <Detail term="Creator" value={truncateAddress(market.creator)} full={market.creator} />
            <Detail
              term="Quote asset"
              value={truncateAddress(market.quoteAsset)}
              full={market.quoteAsset}
            />
            <Detail term="Supply" value="1,000,000,000" />
            <Detail term="Creator allocation" value="0%" />
            <Detail term="Core fee" value="1% — 65% creator, 35% platform" />
            <Detail term="Stockback" value="+1% buy / +2% sell" />
          </dl>
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  suffix,
  emphasis = false,
}: {
  label: string;
  value: string;
  suffix?: string;
  emphasis?: boolean;
}): JSX.Element {
  return (
    <div className={emphasis ? styles.metricPrimary : styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`${styles.metricValue} num`}>
        {/* The number clips, the unit does not. Putting the overflow on the row
            would truncate whichever child came last, which is the unit — and a
            price whose unit reads "xSTOC" is worse than one that wraps. */}
        <span className={styles.metricNumber}>{value}</span>
        {suffix !== undefined && <span className={styles.metricSuffix}>{suffix}</span>}
      </span>
    </div>
  );
}

function Detail({
  term,
  value,
  full,
}: {
  term: string;
  value: string;
  full?: string;
}): JSX.Element {
  return (
    <div className={styles.detail}>
      <dt>{term}</dt>
      {/* The truncated form is what is shown; the full value is available on
          hover and to a screen reader, so nothing is hidden outright (§41). */}
      <dd className="mono" title={full}>
        {value}
      </dd>
    </div>
  );
}

function safeBigint(value: string): bigint | null {
  return /^-?\d+$/.test(value) ? BigInt(value) : null;
}

function normaliseStatus(status: string): MarketStatus {
  return status === "GRADUATED" || status === "GRADUATING" ? status : "PRE_GRAD";
}

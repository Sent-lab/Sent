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

import { getMarket, getTape, isOk, API_BASE } from "../../../lib/api.ts";
import {
  formatCompact,
  formatQuoteCompact,
  formatQuoteFixed,
  truncateAddress,
} from "../../../lib/format.ts";
import { FreshnessBadge } from "../../../components/Freshness.tsx";
import { GraduationProgress, type MarketStatus } from "../../../components/GraduationProgress.tsx";
import { TradePanel } from "../../../components/TradePanel.tsx";
import { ChartPanel } from "../../../components/ChartPanel.tsx";
import { LiveTape } from "../../../components/LiveTape.tsx";
import { FinalizePanel } from "../../../components/FinalizePanel.tsx";
import { WrapPanel } from "../../../components/WrapPanel.tsx";
import { MarketAbout } from "../../../components/MarketAbout.tsx";

import styles from "./terminal.module.css";
import type { JSX } from "react";
import type { Metadata } from "next";

export const revalidate = 0;

/**
 * WHAT A LINK TO THIS MARKET LOOKS LIKE WHEN SOMEBODY PASTES IT (§117)
 * ---------------------------------------------------------------------
 * This returned a bare `title` and nothing else, so a market link pasted into
 * X, Telegram or Discord unfurled as one line of text. The API has generated a
 * 1200×630 card per market this whole time and served it at
 * `/markets/:token/preview.svg`; nothing referenced it, so nothing ever saw it.
 *
 * The description is built from what the market IS rather than from marketing
 * copy: the pair, the supply and the fee are the three facts someone deciding
 * whether to open the link actually wants, and they are LOCKED values so they
 * cannot go stale.
 *
 * THE IMAGE IS A PNG, AND THAT IS WHY
 * -------------------------------------
 * X, Discord and Telegram do not render SVG in an unfurl. They do not fail
 * loudly either — they drop the image and show text — so pointing at the SVG
 * meant a card nobody's client would draw on the three surfaces that matter.
 * The API rasterises the same card at `/preview.png`, which is what this names.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const result = await getMarket(token).catch(() => null);

  if (result === null || !isOk(result)) return { title: "Market" };

  const market = result.data;
  const title = `${market.symbol} — ${market.name}`;
  const description =
    `${market.symbol} is quoted against ${market.quoteSymbol} on SENT. ` +
    `Fixed supply of one billion, no creator allocation, and liquidity that ` +
    `locks permanently when the market graduates.`;

  const image = `${API_BASE}/markets/${market.token}/preview.png`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "SENT",
      type: "website",
      images: [{ url: image, width: 1200, height: 630, type: "image/png", alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
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
      <header className={`${styles.header} m-secondary`}>
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

          {/*
            D-017. A wrapped quote asset is named after what it wraps, and a
            symbol is the one part of a token anybody can copy. Saying the
            wrapper is a wrapper, and naming the address it holds, is what
            separates a real wTSLAx from one that only spells the same — the
            full address is on the details list below.
          */}
          {market.quoteUnderlying != null && (
            <span className={styles.wrapped}>
              {market.quoteSymbol} is a wrapper. It holds{" "}
              <span className="mono" title={market.quoteUnderlying}>
                {truncateAddress(market.quoteUnderlying)}
              </span>
              , and that address is the asset this market is actually quoted against.
            </span>
          )}
          <FreshnessBadge envelope={marketResult.freshness} />
        </div>
      </header>

      {/* --- Metrics ----------------------------------------------------- */}
      <section className={`${styles.metrics} m-secondary`} aria-label="Market metrics">
        <Metric
          label="Price"
          value={
            price === null
              ? "—"
              : // Precision from the magnitude (§41), then padded to it so the
                // figure keeps a stable width as it ticks (§80). A fixed eight
                // places renders a sub-cent price as zeros.
                formatQuoteFixed(price, { grouped: true })
          }
          suffix={market.quoteSymbol}
          emphasis
        />
        <Metric
          label="Curve collateral"
          value={collateral === null ? "—" : formatQuoteCompact(collateral)}
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
        <section className={`${styles.chart} m-secondary`} aria-label="Price chart">
          <ChartPanel
            token={market.token}
            quoteSymbol={market.quoteSymbol}
            quoteDecimals={decimals}
            graduated={status === "GRADUATED"}
            graduatedAt={market.graduatedAt}
          />
        </section>

        <aside className={`${styles.trade} m-secondary`} aria-label="Trade">
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

          {/*
            Next to the trade panel, not behind a link.

            A user holding the xStock cannot trade here until they wrap, so this
            is the step that unblocks the panel directly above it. §44 is against
            making someone hunt for the thing standing between them and the
            action they came to take — and only markets whose quote asset is
            actually a wrapper show it at all.
          */}
          {market.quoteUnderlying != null && (
            <WrapPanel
              wrapper={market.quoteAsset}
              underlying={market.quoteUnderlying}
              wrapperSymbol={market.quoteSymbol}
              decimals={decimals}
            />
          )}
        </aside>
      </div>

      {/* --- Graduation --------------------------------------------------- */}
      <section className={`${styles.graduation} m-secondary`} aria-label="Graduation">
        <GraduationProgress
          progressBps={market.graduationProgressBps.value}
          status={status}
          quoteSymbol={market.quoteSymbol}
          size="lg"
        />

        {/*
          The one state where the product needs the user to act.

          §16 makes `finalizeGraduation()` permissionless so a stalled market is
          never anyone's hostage — but that only means something if a holder can
          reach it. Rendered here, under the progress bar that shows the curve at
          100%, because this is where someone looking at a stuck market looks.
        */}
        {status === "GRADUATING" && (
          <FinalizePanel
            market={market.market}
            symbol={market.symbol}
            quoteSymbol={market.quoteSymbol}
            quoteDecimals={decimals}
            distributed={market.distributed.value}
            curveCollateral={market.curveCollateral.value}
          />
        )}
      </section>

      {/*
        What the creator published, and whether it still matches the commitment
        in the token's address (§412). The API has served both since launch and
        nothing rendered them — including the one field that says whether this
        market is what it claims to be.

        Full width, above the activity grid: it is about identity, and identity
        reads before history.
      */}
      <div className="m-secondary">
        <MarketAbout metadata={market.metadata} symbol={market.symbol} />
      </div>

      {/* --- Activity + details ------------------------------------------ */}
      <div className={styles.lower}>
        <section className={`${styles.activity} m-secondary`} aria-label="Recent trades">
          {/* Server-rendered rows, then live ones prepended over the socket. The
              tape is the surface where §22's "no manual refresh" is most
              visible, and the one where a silent gap is least acceptable. */}
          <LiveTape
            market={market.market}
            quoteDecimals={decimals}
            initial={tapeResult !== null && isOk(tapeResult) ? tapeResult.data : []}
          />
        </section>

        <section className={`${styles.details} m-secondary`} aria-label="Market details">
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
            {/* Only when there is one. An absent row says "not a wrapper";
                a row reading "—" would say "we did not check", and those are
                different claims (§87). */}
            {market.quoteUnderlying != null && (
              <Detail
                term="Wraps"
                value={truncateAddress(market.quoteUnderlying)}
                full={market.quoteUnderlying}
              />
            )}
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

/**
 * SENT — market pulse (§52, §53, §213).
 *
 * §213 names "market pulse" as a homepage element between the discovery rails
 * and the create CTA. There was none, and `/platform/pulse` was served and
 * unread.
 *
 * WHY THE VOLUME HERE HAS A UNIT AND THE PLATFORM TOTAL DOES NOT
 * --------------------------------------------------------------
 * `/platform/stats` sums notionals across every market with no conversion, so
 * its total adds TSLAx to NVDAx and cannot be labelled — see `PlatformStats`
 * for why that figure is deliberately absent from this page.
 *
 * Pulse reports the same trades grouped BY QUOTE ASSET, each row carrying its
 * own symbol. That is the same data in a shape that can be shown honestly, and
 * it is why volume appears here and nowhere else on the homepage.
 *
 * TWO WINDOWS, BOTH NAMED
 * -----------------------
 * Presence covers a short window and heat a longer one, and the API returns
 * both lengths precisely so a client cannot render either as "right now". §53
 * is explicit that `activeTraders` counts distinct traders and not open
 * sockets — the flattering number would be the other one — so the label says
 * traders and the window says over how long.
 *
 * BUY PRESSURE IS CENTRED, NOT A PERCENTAGE OF ANYTHING
 * -----------------------------------------------------
 * 10000 bps is every unit of volume being a buy and 5000 is balanced, which the
 * API also returns for a window with no volume at all. So a bare "50%" would
 * read as a measurement in a market where nothing happened. It is shown as a
 * lean either side of even, and only when the window had trades.
 */

import { getPulse, isOk } from "../lib/api.ts";
import { formatCompact } from "../lib/format.ts";

import styles from "./MarketPulse.module.css";
import type { JSX } from "react";

function hours(seconds: number): string {
  const h = Math.round(seconds / 3600);
  return h >= 1 ? `${h}h` : `${Math.round(seconds / 60)}m`;
}

function big(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

/**
 * Buy pressure as a lean, or null when the window is empty.
 *
 * 5000 with no trades is the API's neutral placeholder rather than a finding,
 * and rendering it as "balanced" would state something nobody measured.
 */
function lean(bps: number, trades: number): string | null {
  if (trades === 0) return null;
  if (bps === 5000) return "evenly split";

  const side = bps > 5000 ? "buys" : "sells";
  const share = Math.round((bps > 5000 ? bps : 10_000 - bps) / 100);
  return `${share}% ${side}`;
}

export async function MarketPulse(): Promise<JSX.Element | null> {
  const result = await getPulse({ revalidateSeconds: 15 }).catch(() => null);

  // Nothing rather than a shell of dashes: a pulse section full of zeros says
  // the platform is dead, when what is true is that we could not ask.
  if (result === null || !isOk(result)) return null;

  const { ecosystems, presence, heatWindowSeconds } = result.data;
  if (ecosystems.length === 0 && presence.trades === 0) return null;

  return (
    <section className={styles.pulse} aria-label="Market pulse">
      <header className={styles.head}>
        <h2 className={styles.title}>Market pulse</h2>
        <p className={styles.window}>Last {hours(heatWindowSeconds)}</p>
      </header>

      <dl className={styles.presence}>
        <Presence
          term="Traders"
          value={formatCompact(BigInt(presence.activeTraders), 0)}
          detail={`Distinct addresses that traded in the last ${hours(presence.windowSeconds)} — not connections.`}
        />
        <Presence
          term="Live markets"
          value={formatCompact(BigInt(presence.liveMarkets), 0)}
          detail="Markets with at least one trade in the window."
        />
        <Presence
          term="Near graduation"
          value={formatCompact(BigInt(presence.nearGraduation), 0)}
          detail="Close enough that the next few buys could close the curve."
        />
        <Presence
          term="Graduated recently"
          value={formatCompact(BigInt(presence.graduatedRecently), 0)}
          detail="Curves closed and liquidity locked in the window."
        />
      </dl>

      {ecosystems.length > 0 && (
        <ul className={styles.ecosystems}>
          {ecosystems.map((e) => {
            const pressure = lean(e.buyPressureBps, e.trades);

            return (
              <li key={e.quoteAsset} className={styles.ecosystem}>
                <div className={styles.ecosystemHead}>
                  <span className={styles.ecosystemSymbol}>{e.quoteSymbol}</span>
                  <span className={styles.ecosystemMarkets}>
                    {e.activeMarkets} of {e.totalMarkets} trading
                  </span>
                </div>

                <div className={styles.ecosystemFigures}>
                  {/* Labelled with the pair's OWN symbol, which is the whole
                      reason this figure can be shown at all. */}
                  <span className={`${styles.ecosystemVolume} num`}>
                    {formatCompact(big(e.volume), 18)} {e.quoteSymbol}
                  </span>
                  <span className={styles.ecosystemMeta}>
                    {formatCompact(BigInt(e.trades), 0)} trades
                    {pressure !== null && <> · {pressure}</>}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Presence({
  term,
  value,
  detail,
}: {
  term: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className={styles.presenceItem}>
      <dt className={styles.presenceTerm}>{term}</dt>
      <dd className={`${styles.presenceValue} num`}>{value}</dd>
      <dd className={styles.presenceDetail}>{detail}</dd>
    </div>
  );
}

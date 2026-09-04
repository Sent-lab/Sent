/**
 * SENT — social preview cards (§117, §95.25).
 *
 * A 1200×630 SVG per market, generated on request. This is what a link to a
 * token looks like when somebody pastes it into X, Telegram or Discord.
 *
 * THE TOKEN'S OWN IMAGE IS DELIBERATELY NOT EMBEDDED
 * ---------------------------------------------------
 * §95.25 says the preview "harus tetap bagus walaupun token image buruk atau
 * tidak ada" — it must still look good when the token image is bad or missing.
 * The usual reading is "have a fallback". The better one is to not depend on it.
 *
 * Fetching a creator-supplied IPFS CID from a public, unauthenticated endpoint
 * would mean:
 *
 *   an outbound request per crawler hit, from our infrastructure, to a URL the
 *   creator chose — which is a request-forgery surface with a public trigger;
 *
 *   a card whose render time is a stranger's gateway's latency, on the endpoint
 *   that is hit most and cached least reliably;
 *
 *   and an image that can change after the preview was approved, because a CID
 *   pin can be dropped and a gateway can serve anything for an unpinned one.
 *
 * So the mark is DERIVED from the token address instead: deterministic, always
 * available, unique per market, and impossible to get wrong. It reads as a
 * choice rather than as a fallback, which is the difference §95.25 is pointing
 * at. Clients that want the real logo have the CID from the API and can fetch it
 * themselves, in a browser, where the request is the user's and not ours.
 *
 * SVG, AND WHY THIS STOPS HERE
 * ----------------------------
 * Most crawlers want PNG for `og:image`. Rasterising needs a native dependency
 * — resvg, sharp, a headless browser — and which one depends on the runtime,
 * which §434 has not fixed. Everything that carries product knowledge is in
 * this file: what to show, how it degrades, how it looks. Rasterisation is a
 * mechanical transform behind a documented seam, in the same shape as
 * `IGraduationRouter` and `IReferencePriceAdapter`.
 */

export interface PreviewMarket {
  readonly symbol: string;
  readonly name: string;
  readonly quoteSymbol: string;
  readonly token: string;
  readonly status: string;
  /** Basis points of the graduation endpoint. 10000 = graduated. */
  readonly graduationProgressBps: bigint;
  /** Reference market cap in USD wad (§18). Runs $2,000 → $50,000. */
  readonly referenceMarketCapUsd: bigint;
  readonly holderCount: number;
}

const WIDTH = 1200;
const HEIGHT = 630;

/** The brand tokens, duplicated here on purpose — see below. */
const INK = "#050607";
const SURFACE = "#0d0f12";
const BORDER = "#1f262c";
const TEXT = "#f5f7fa";
const DIM = "#9aa4b2";
const VOLT = "#c6f600";
const UP = "#34d399";
/** The one state a reader should look twice at (§42). Matches the app token. */
const WARN = "#fbbf24";

/**
 * Escape text for XML.
 *
 * Every string here is creator-supplied. A token named `</text><script>` would
 * otherwise close the element and inject markup into a document that other
 * people's servers fetch and some render — and unlike the web app, this output
 * has no framework escaping anything on the way out.
 */
function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Truncate to a width that fits, by character count.
 *
 * Approximate on purpose: measuring a glyph needs the font, and the font is not
 * loaded here. Over-truncating costs a few characters; under-truncating pushes
 * text off a card that cannot scroll, so the estimate errs short.
 */
function fit(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** USD wad to a compact display figure. Never a float (§424). */
function usd(wad: bigint): string {
  const dollars = wad / 10n ** 18n;

  if (dollars >= 1_000_000n) return `$${(dollars / 1_000n).toString().slice(0, -3)}M`;
  if (dollars >= 1_000n) return `$${dollars / 1_000n}K`;
  return `$${dollars}`;
}

/**
 * A deterministic mark for a token, from its address.
 *
 * Six bars whose heights come from address bytes, in a hue that also comes from
 * the address. Every market gets a different one, the same one every time, and
 * it needs nothing but the address to draw.
 *
 * Not an attempt at a logo. It is a recognisable shape that says "this is a
 * specific market" — which is the job a preview image actually has when someone
 * is scrolling past it.
 */
function mark(token: string, x: number, y: number): string {
  const hex = token.replace(/^0x/, "");
  const bytes = Array.from({ length: 6 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0);

  // The hue comes from the address too, so two markets are never the same
  // colour by accident, and one market is never a different colour by accident.
  const hue = (bytes.reduce((a, b) => a + b, 0) * 7) % 360;

  const bars = bytes
    .map((b, i) => {
      const height = 24 + (b / 255) * 84;
      return `<rect x="${x + i * 20}" y="${y + 108 - height}" width="12" height="${height.toFixed(1)}" rx="4" fill="hsl(${hue} 70% ${45 + i * 4}%)" />`;
    })
    .join("");

  return `<g opacity="0.95">${bars}</g>`;
}

/**
 * The card.
 *
 * Brand colours are literals here rather than CSS variables. An SVG served to a
 * crawler has no stylesheet, no cascade and no `:root` — every value has to be
 * in the document. The duplication is real and is the price of the file being
 * self-contained; `packages/ui/tokens.css` remains the source anyone editing
 * these should read first.
 */
export function renderPreview(m: PreviewMarket): string {
  const progress = Number(m.graduationProgressBps > 10_000n ? 10_000n : m.graduationProgressBps) / 100;
  const graduated = m.status === "GRADUATED";

  const barWidth = 1040;
  const filled = Math.max((barWidth * progress) / 100, progress > 0 ? 6 : 0);

  /*
   * THREE STATES, NOT TWO (D-016, §228)
   * -----------------------------------
   * This asked one question — has it GRADUATED — so a market in GRADUATING was
   * labelled "ON THE CURVE" on the card that gets shared. Its curve is
   * permanently shut and nothing can be bought or sold, which is close to the
   * opposite of what that label says, and this is the surface that travels
   * furthest from anyone who could correct it.
   *
   * The same binary check was in the trade panel and had the same consequence
   * there. It is the shape a state machine leaves behind when it grows a state:
   * every `x ? a : b` written against the old one keeps compiling.
   */
  const statusLabel =
    m.status === "GRADUATED"
      ? "GRADUATED"
      : m.status === "GRADUATING"
        ? "GRADUATING"
        : "ON THE CURVE";

  // Amber for GRADUATING: it is neither done nor proceeding normally, and §42
  // keeps that colour for the state a reader should look twice at.
  const statusColour =
    m.status === "GRADUATED" ? UP : m.status === "GRADUATING" ? WARN : VOLT;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${xml(`${m.symbol} paired with ${m.quoteSymbol}`)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${INK}" />
      <stop offset="1" stop-color="${SURFACE}" />
    </linearGradient>
    <linearGradient id="progress" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${VOLT}" stop-opacity="0.65" />
      <stop offset="1" stop-color="${VOLT}" />
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  <rect x="0" y="0" width="${WIDTH}" height="4" fill="${VOLT}" />

  <!-- Brand mark. §231: the platform is named on anything that travels. -->
  <g transform="translate(80 72)">
    <path d="M0 0 L26 0 L14 20 L26 20 L0 44 L12 24 L0 24 Z" fill="${VOLT}" />
    <text x="44" y="30" font-family="Sora, system-ui, sans-serif" font-size="26" font-weight="600" letter-spacing="6" fill="${TEXT}">SENT</text>
  </g>

  <g transform="translate(1120 78)" text-anchor="end">
    <text font-family="Sora, system-ui, sans-serif" font-size="18" font-weight="600" letter-spacing="2" fill="${statusColour}">${statusLabel}</text>
  </g>

  ${mark(m.token, 80, 180)}

  <!--
    The pair follows the symbol as a tspan, not at a computed x.

    It used to be positioned at "80 + symbolLength * 58", which assumes every
    glyph in a proportional face is 58px wide at this size. "WIND" is wider than
    that and the two ran into each other; "III" is narrower and left a hole. A
    tspan continues at the text cursor the renderer is already tracking, so the
    gap is exact for any symbol without measuring anything.
  -->
  <text x="80" y="380" font-family="Sora, system-ui, sans-serif" font-size="96" font-weight="700" letter-spacing="-3" fill="${TEXT}">${xml(fit(m.symbol, 12))}<tspan dx="28" font-size="40" font-weight="500" letter-spacing="0" fill="${DIM}">/ ${xml(fit(m.quoteSymbol, 10))}</tspan></text>

  <text x="80" y="428" font-family="Sora, system-ui, sans-serif" font-size="28" font-weight="400" fill="${DIM}">${xml(fit(m.name, 46))}</text>

  <!-- The two figures worth a glance: what it is worth, and how far it has to go. -->
  <g transform="translate(80 486)">
    <text font-family="Sora, system-ui, sans-serif" font-size="15" letter-spacing="2" fill="${DIM}">REFERENCE MARKET CAP</text>
    <text y="42" font-family="Sora, system-ui, sans-serif" font-size="40" font-weight="600" fill="${TEXT}">${usd(m.referenceMarketCapUsd)}</text>
  </g>

  <g transform="translate(420 486)">
    <text font-family="Sora, system-ui, sans-serif" font-size="15" letter-spacing="2" fill="${DIM}">HOLDERS</text>
    <text y="42" font-family="Sora, system-ui, sans-serif" font-size="40" font-weight="600" fill="${TEXT}">${m.holderCount}</text>
  </g>

  <g transform="translate(700 486)">
    <text font-family="Sora, system-ui, sans-serif" font-size="15" letter-spacing="2" fill="${DIM}">GRADUATION</text>
    <text y="42" font-family="Sora, system-ui, sans-serif" font-size="40" font-weight="600" fill="${graduated ? UP : TEXT}">${progress.toFixed(1)}%</text>
  </g>

  <!-- §199's progress, as the one thing that reads at a glance while scrolling. -->
  <rect x="80" y="566" width="${barWidth}" height="10" rx="5" fill="${BORDER}" />
  ${filled > 0 ? `<rect x="80" y="566" width="${filled.toFixed(1)}" height="10" rx="5" fill="url(#progress)" />` : ""}
</svg>`;
}

/**
 * How long a crawler may keep this.
 *
 * Five minutes fresh, an hour stale-while-revalidate. A preview is a snapshot
 * by nature — the moment it is posted, it is already historical — and the
 * alternative is regenerating a card on every crawler hit for a number that
 * moved by a fraction of a percent.
 *
 * `stale-while-revalidate` matters more than the freshness window: a preview
 * that 500s because the database is slow is a link that renders as a bare URL,
 * and a slightly old card is better than no card by a wide margin.
 */
export const PREVIEW_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";

/**
 * SENT — social preview audit (§117, §95.25).
 *
 * Two things are being checked.
 *
 * The first is injection. Every string on this card is creator-supplied, and
 * the output is a document that other people's servers fetch and some render.
 * Unlike the web app there is no framework escaping anything on the way out —
 * this file is the only thing standing between a token named `</text><script>`
 * and markup inside somebody else's preview.
 *
 * The second is that it degrades. §95.25 requires the preview to still look
 * good when the token image is bad or missing, and the design answer was to not
 * depend on it at all — so what has to hold is that a market with no name, no
 * trades and no holders still produces a card rather than a broken rectangle.
 *
 * Run: pnpm sim:preview
 */

import { renderPreview, type PreviewMarket } from "../src/preview.ts";

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const BASE: PreviewMarket = {
  symbol: "TEST",
  name: "Sent Test Market",
  quoteSymbol: "NVDAx",
  token: "0x17de344ed445ed0650fdc68a1de14fc09f9ae5dd",
  status: "PRE_GRAD",
  graduationProgressBps: 4_250n,
  referenceMarketCapUsd: 21_250n * 10n ** 18n,
  holderCount: 137,
};

// ---------------------------------------------------------------------------

section("The card is a well-formed SVG at OG dimensions");

{
  const svg = renderPreview(BASE);

  check("it is an SVG document", svg.startsWith("<svg") && svg.trimEnd().endsWith("</svg>"));
  check("with the XML namespace crawlers need", svg.includes('xmlns="http://www.w3.org/2000/svg"'));

  // 1200×630 is the Open Graph standard. A card at any other ratio is cropped
  // by every platform differently, which is worse than being slightly wrong.
  check("at 1200×630", svg.includes('width="1200"') && svg.includes('height="630"'));

  // Tags balance. A rough parse, but it catches the failure that matters: an
  // unclosed element, which most renderers show as nothing at all.
  const opens = (svg.match(/<(?!\/)(?!\?)[a-zA-Z]/g) ?? []).length;
  const closes = (svg.match(/<\//g) ?? []).length;
  const selfClosing = (svg.match(/\/>/g) ?? []).length;
  check("every element is closed", opens === closes + selfClosing);
}

section("Creator-supplied strings cannot break out");

{
  /*
   * The attack this file exists to stop. A token named with markup would
   * otherwise close the `<text>` element and inject into a document that
   * other people's infrastructure fetches.
   */
  const hostile = renderPreview({
    ...BASE,
    symbol: "</text><script>alert(1)</script>",
    name: '"><foreignObject><body onload="alert(2)">',
    quoteSymbol: "A&B",
  });

  check("no script element survives", !hostile.includes("<script"));
  check("nor a foreignObject", !hostile.includes("<foreignObject"));
  // `onload=` survives as TEXT, which is inert — what must not survive is
  // `onload="`, the attribute form. Asserting on the substring alone would
  // demand the escaper delete content rather than escape it.
  check("nor an inline handler as an attribute", !hostile.includes('onload="'));
  check("though the text is kept, escaped", hostile.includes("onload=&quot;"));

  check("angle brackets are escaped", hostile.includes("&lt;") || !hostile.includes("</text><"));
  check("ampersands are escaped", hostile.includes("&amp;"));

  // Still a valid document afterwards, not a mangled one.
  check("and the card still closes", hostile.trimEnd().endsWith("</svg>"));
}

{
  // A quoted string inside an attribute — the aria-label is built from creator
  // text, and an unescaped quote there ends the attribute early.
  const quoted = renderPreview({ ...BASE, symbol: 'A" onclick="x' });
  check("quotes inside attributes are escaped", !quoted.includes('onclick="x"'));
}

section("It degrades rather than breaking");

{
  const empty = renderPreview({
    ...BASE,
    symbol: "",
    name: "",
    quoteSymbol: "",
    graduationProgressBps: 0n,
    referenceMarketCapUsd: 0n,
    holderCount: 0,
  });

  // A market on its first second: no name yet, no trades, no holders. It still
  // has to produce a card, because that is the moment it is most likely to be
  // shared.
  check("an empty market still renders", empty.startsWith("<svg") && empty.length > 500);
  check("with a zero market cap shown as $0", empty.includes("$0"));
  check("and no progress bar fill", !empty.includes('fill="url(#progress)"'));
}

{
  const long = renderPreview({
    ...BASE,
    symbol: "SUPERCALIFRAGILISTIC",
    name: "A".repeat(400),
  });

  // A card cannot scroll. Text that overflows is text nobody sees, on the
  // element that was supposed to say what the token is.
  check("an overlong symbol is truncated", long.includes("…"));
  check("and the card is still valid", long.trimEnd().endsWith("</svg>"));
}

{
  const graduated = renderPreview({
    ...BASE,
    status: "GRADUATED",
    graduationProgressBps: 10_000n,
    referenceMarketCapUsd: 50_000n * 10n ** 18n,
  });

  check("a graduated market says so", graduated.includes("GRADUATED"));
  check("at 100.0%", graduated.includes("100.0%"));
  check("and $50K, which is §18's endpoint", graduated.includes("$50K"));
}

{
  // Progress above the endpoint is not a state the curve reaches, but a
  // projection mid-graduation can report it. The bar must not run off the card.
  const over = renderPreview({ ...BASE, graduationProgressBps: 25_000n });
  check("progress is clamped at 100%", over.includes("100.0%"));
}

section("The mark is derived, not fetched");

{
  const a = renderPreview(BASE);
  const b = renderPreview({ ...BASE, token: "0xdd875cd79dc6e1d3b09f3dda4b1b19aa8375558e" });

  /*
   * No network call from a public, unauthenticated endpoint. Fetching a
   * creator-supplied IPFS URL here would be request forgery with a public
   * trigger, and would make render time a stranger's gateway's latency.
   */
  // The XML namespace is a URI and is not a fetch, so it is excluded rather
  // than counted — a check that flagged it would have to be weakened to pass,
  // and a weakened check is one nobody trusts later.
  const withoutNamespace = a.replace(/xmlns="[^"]*"/g, "");

  check(
    "nothing external is referenced",
    !withoutNamespace.includes("http") && !withoutNamespace.includes("ipfs"),
  );
  check("and nothing is fetched at render time", !a.includes("<image"));

  // Different market, different mark. Same market, same mark — a preview that
  // changed between two shares of the same link would look like two tokens.
  check("two markets get different marks", a !== b);
  check("and one market is stable", renderPreview(BASE) === a);
}

{
  // A short or malformed address must not produce NaN in the geometry, which
  // renders as nothing.
  const short = renderPreview({ ...BASE, token: "0x00" });
  check("a malformed address does not produce NaN", !short.includes("NaN"));
}

section("The platform is named on anything that travels");

{
  const svg = renderPreview(BASE);
  check("the brand mark is present (§231)", svg.includes("SENT"));
  check("and the pair is stated", svg.includes("NVDAx"));
}

console.log(failures === 0 ? "\npreview: all checks passed" : `\npreview: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

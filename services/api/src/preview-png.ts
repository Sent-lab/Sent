/**
 * SENT — the social preview, rasterised (§117, §95.25).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `preview.ts`
 * -------------------------------------------------
 * `preview.ts` holds every decision about what the card SAYS: which figures,
 * how it degrades, why the creator's IPFS image is deliberately not fetched.
 * None of that changes when the output format does.
 *
 * This is the mechanical half — SVG in, PNG out — kept behind its own seam so
 * the product knowledge stays in one file and the native dependency stays in
 * the other. `preview.ts` predicted this shape and named it; this is that.
 *
 * WHY A PNG AT ALL, WHEN THE SVG IS ALREADY CORRECT
 * -------------------------------------------------
 * X, Discord and Telegram do not render SVG in a link unfurl. They do not fail
 * loudly either — they drop the image and show text — so an SVG-only card is
 * invisible on precisely the three surfaces §117 is about. A card that nobody's
 * client will draw is a card that does not exist.
 *
 * THE FONT IS VENDORED, AND IT HAS TO BE
 * --------------------------------------
 * The API runs on `node:22-alpine`, which ships no fonts at all. `loadSystemFonts`
 * is therefore set to FALSE rather than left at its default: on a developer's
 * machine the default would quietly find a system face and produce a card that
 * looks right locally and renders blank in production. Failing the same way
 * everywhere is worth more than succeeding by accident in one place.
 *
 * Sora is the brand face and is OFL-licensed; the licence travels with it in
 * `assets/fonts/OFL.txt`.
 *
 * THREE STATIC FILES, NOT ONE VARIABLE ONE
 * ----------------------------------------
 * Google ships Sora only as a variable font, and one file covering 100-800
 * would have been the obvious choice. resvg does not apply the `wght` axis: it
 * renders every weight at the face's default instance, so the card came out
 * uniformly Regular — the symbol, which is the whole point of the card, was
 * indistinguishable from its own caption.
 *
 * A first probe compared PNG byte lengths across weights, saw them differ, and
 * read that as the axis working. It was not; compression noise is not evidence.
 * Looking at the rendered card is what settled it.
 *
 * So the three weights the card asks for are instantiated from that variable
 * font and vendored. Regenerate with:
 *
 *     python -c "from fontTools.ttLib import TTFont; from fontTools.varLib  *       import instancer; f=TTFont('Sora[wght].ttf');  *       instancer.instantiateVariableFont(f,{'wght':600},inplace=True,  *       updateFontNames=True); f.save('Sora-SemiBold.ttf')"
 *
 * RASTERISING IS NOT FREE, SO IT IS NOT DONE PER REQUEST
 * ------------------------------------------------------
 * A crawler hit is the least predictable traffic this service takes: it arrives
 * in bursts, from many clients, for the same handful of markets, the moment a
 * link is posted. The renderer is memoised on the exact SVG bytes, so a burst
 * for one market rasterises once and serves the rest from memory.
 *
 * The cache is bounded and keyed by content, not by token: a market whose
 * numbers moved produces different bytes and misses, which is the correct
 * behaviour and needs no invalidation logic to get right.
 */

import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const HERE = dirname(fileURLToPath(import.meta.url));

const FONTS = ["Sora-Regular.ttf", "Sora-SemiBold.ttf", "Sora-Bold.ttf"].map((file) =>
  join(HERE, "..", "assets", "fonts", file),
);

/**
 * Checked once, at module load, so a missing font is a startup failure.
 *
 * The alternative is serving text-less cards for a week before anyone notices:
 * a preview rendered without its font is not degraded, it is blank exactly
 * where the symbol should be, and a crawler caches that.
 */
for (const path of FONTS) statSync(path);

/** Bounded so a long-running process cannot grow without limit. */
const MAX_CACHED = 64;
const cache = new Map<string, Buffer>();

export const PNG_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";

/**
 * Rasterise one preview card.
 *
 * @param svg The exact markup `renderPreview` produced. Not re-derived here —
 *            the PNG and the SVG must be the same card, and the only way to
 *            guarantee that is for one to be a transform of the other.
 */
export function renderPreviewPng(svg: string): Buffer {
  const hit = cache.get(svg);
  if (hit !== undefined) return hit;

  const png = new Resvg(svg, {
    font: {
      fontFiles: FONTS,
      // Named so a face lookup that misses still lands on the brand face
      // rather than on nothing.
      defaultFontFamily: "Sora",
      // See the note above: never inherit whatever the host happens to have.
      loadSystemFonts: false,
    },
    // The SVG already declares 1200×630. Rendering at its own width keeps the
    // two outputs identical rather than similar.
    fitTo: { mode: "original" },
  })
    .render()
    .asPng();

  // Oldest out first. A Map iterates in insertion order, so the first key is
  // the least recently added — good enough for a cache this small, and it
  // cannot get the eviction order subtly wrong the way a hand-rolled LRU can.
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }

  cache.set(svg, png);
  return png;
}

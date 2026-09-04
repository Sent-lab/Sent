/**
 * SENT — brand mark.
 *
 * WHERE THIS GEOMETRY COMES FROM
 * ------------------------------
 * `Brand.png`, in the repository root, measured. The previous version of this
 * file was drawn by eye from that board and said so; it was three flat slabs and
 * the real mark is two stepped diagonal forms with 180° rotational symmetry, so
 * it did not look like the brand on any page that used it — which is every page,
 * plus the favicon.
 *
 * The board was there the whole time. The shape is a measurement rather than an
 * opinion: the volt-lime pixels were masked, the two components traced with a
 * Moore boundary walk, and each contour reduced to the handful of vertices it
 * actually has. Re-derive with `scripts/trace-mark.py` if the board changes.
 *
 * WHY THE CORNERS ARE A STROKE AND NOT ARCS
 * -----------------------------------------
 * Every corner on the mark is rounded by the same radius. Writing that as arc
 * segments would mean twelve hand-tuned curves per path and a shape nobody can
 * safely edit afterwards.
 *
 * Instead each path is the outline INSET by the corner radius, stroked with
 * twice that radius and a round line join. The stroke grows the shape back to
 * its true size with every corner rounded uniformly and exactly. It is why the
 * polygons below are traced from an eroded mask rather than the raw one.
 *
 * The mark is never re-coloured beyond the LOCKED palette and never stretched:
 * `preserveAspectRatio` is left at its default for exactly that reason.
 */

import type { JSX } from "react";

/**
 * The two forms, inset by {@link CORNER}, in a 32×32 box.
 *
 * Traced from `Brand.png`. The pair reads as an S at a glance and as two
 * offset slabs up close, which is what the board's "clear space and grid" panel
 * is protecting — hence the margin baked into these coordinates.
 */
const UPPER = "M 14.16 1.96 L 20.23 8.34 L 22.78 8.82 L 28.37 8.66 L 29.96 10.41 L 29.96 16.64 L 28.85 17.6 L 14.8 8.5 L 14.32 7.38 L 14.16 2.12 Z";
const LOWER = "M 3.15 13.29 L 11.29 20.31 L 18.95 24.3 L 19.59 25.89 L 19.59 30.04 L 12.09 22.38 L 4.27 22.38 L 2.99 21.9 L 2.2 20.63 L 2.04 18.55 L 2.04 15.04 L 2.99 13.45 Z";

/** Corner radius in viewBox units, from the board. */
const CORNER = 0.957;

export interface LogoProps {
  readonly size?: number;
  /** `mark` is the glyph alone; `full` sets it beside the wordmark. */
  readonly variant?: "mark" | "full";
  readonly glow?: boolean;
  readonly className?: string;
}

export function Logo({
  size = 32,
  variant = "mark",
  glow = false,
  className,
}: LogoProps): JSX.Element {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      // Decorative when the wordmark is present, since the text already names
      // the product; announced when the glyph stands alone (§84).
      role={variant === "full" ? "presentation" : "img"}
      aria-label={variant === "full" ? undefined : "SENT"}
      style={glow ? { filter: "drop-shadow(0 0 8px rgba(198, 246, 0, 0.5))" } : undefined}
    >
      <g
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={CORNER * 2}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d={UPPER} />
        <path d={LOWER} />
      </g>
    </svg>
  );

  if (variant === "mark") {
    return (
      <span className={className} style={{ color: "var(--volt)", display: "inline-flex" }}>
        {mark}
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: `${Math.round(size * 0.35)}px`,
        color: "var(--volt)",
      }}
    >
      {mark}
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          color: "var(--text)",
        }}
      >
        <span
          style={{
            fontSize: `${Math.round(size * 0.6)}px`,
            fontWeight: 600,
            // The wordmark is letterspaced in the brand board; it is the one
            // place in the system where tracking is this wide.
            letterSpacing: "0.32em",
            lineHeight: 1,
          }}
        >
          SENT
        </span>
        {size >= 32 && (
          <span
            style={{
              fontSize: `${Math.max(7, Math.round(size * 0.22))}px`,
              letterSpacing: "0.18em",
              color: "var(--volt)",
              lineHeight: 1,
            }}
          >
            LAUNCH. PAIR. CREATE MARKET.
          </span>
        )}
      </span>
    </span>
  );
}

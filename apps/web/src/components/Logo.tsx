/**
 * SENT — brand mark.
 *
 * WHERE THIS GEOMETRY COMES FROM
 * ------------------------------
 * `Logo SENT.png`, the official export, measured. Not drawn by eye — an earlier
 * version of this file was, and it was three flat slabs where the mark is two
 * stepped diagonal forms, on every page and in the favicon.
 *
 * `scripts/trace-mark.py` masks the artwork's alpha channel, walks each form's
 * boundary and reduces it to the vertices it actually has. It prints exactly the
 * constants below; run it when the artwork changes.
 *
 * WHY THESE ARE PLAIN FILLED POLYGONS
 * -----------------------------------
 * A version before this traced an eroded mask and stroked it with a round join,
 * which is how you round the corners of a shape whose corners are sharp in the
 * source. This one's are not — the export already has its rounding — so that
 * rounded everything twice and spent two dozen vertices retracing curves that
 * were already there.
 *
 * Tracing the outline as it stands reproduces the artwork, including corners
 * that differ from one another. Roughly thirty vertices per form, with a
 * simplification error near 0.05 viewBox units: a twentieth of a pixel at 32px,
 * under one pixel on a 512px app icon.
 *
 * The mark is never re-coloured beyond the LOCKED palette and never stretched:
 * `preserveAspectRatio` is left at its default for exactly that reason.
 */

import type { JSX } from "react";

/**
 * The two forms, in a 32×32 box, traced from the official export.
 *
 * The pair reads as an S at a glance and as two offset slabs up close, which is
 * what the board's clear-space panel is protecting — hence the margin baked
 * into these coordinates.
 */
const UPPER =
  "M 13.94 1.0 L 14.63 1.03 L 15.32 1.38 L 22.43 8.53 L 22.78 8.77 L 23.2 8.98 L 23.96 9.18 L 29.37 9.22 L 30.06 9.5 L 30.48 9.84 L 30.86 10.47 L 31.0 11.09 L 31.0 17.99 L 30.86 18.69 L 30.48 19.35 L 29.86 19.87 L 29.06 20.14 L 27.5 20.14 L 26.7 19.87 L 20.28 15.25 L 13.83 10.88 L 13.28 10.4 L 12.83 9.71 L 12.65 9.18 L 12.58 8.7 L 12.58 2.42 L 12.72 1.87 L 12.93 1.55 L 13.35 1.21 L 13.9 1.03 Z";

const LOWER =
  "M 3.08 11.92 L 4.68 11.96 L 5.13 12.1 L 5.61 12.38 L 11.96 18.24 L 18.72 22.29 L 19.38 22.85 L 19.8 23.47 L 20.04 24.41 L 20.04 29.72 L 19.94 30.17 L 19.76 30.48 L 19.31 30.86 L 18.86 31.0 L 18.27 30.93 L 17.96 30.76 L 17.27 30.03 L 11.58 23.4 L 11.09 22.95 L 10.36 22.54 L 9.53 22.33 L 2.8 22.33 L 1.97 22.05 L 1.49 21.64 L 1.14 21.05 L 1.0 20.42 L 1.03 13.8 L 1.31 13.03 L 1.66 12.58 L 2.21 12.17 L 2.7 11.99 L 3.05 11.96 Z";

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
      <g fill="currentColor">
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

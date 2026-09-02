/**
 * SENT — brand mark.
 *
 * ⚠ PLACEHOLDER GEOMETRY. The brand board lists an official SVG export as READY,
 * and that file is not in this repository. This is a faithful reconstruction of
 * the mark — two offset parallelogram slabs on the diagonal — drawn from the
 * board so the interface is not blocked on an asset handoff.
 *
 * It must be replaced by the official export before launch. §699 treats brand
 * and address integrity as the same class of problem: an approximated logo is a
 * small wrongness that ships everywhere, on every page, in the favicon and the
 * share image. Tracked as an open item rather than left to be noticed later.
 *
 * The mark is never re-coloured beyond the LOCKED palette, and never stretched:
 * `preserveAspectRatio` is left at its default for exactly that reason.
 */

import type { JSX } from "react";

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
      {/* Upper slab: leans right, sits above the diagonal. */}
      <path
        d="M17.2 3.4 L28.6 3.4 L23.4 13.2 L12 13.2 Z"
        fill="currentColor"
        rx="1"
      />
      {/* Lower slab: the mirrored offset that closes the S. */}
      <path
        d="M8.6 18.8 L20 18.8 L14.8 28.6 L3.4 28.6 Z"
        fill="currentColor"
      />
      {/* The connecting stroke. Narrower than the slabs, which is what stops the
          mark reading as two unrelated bars. */}
      <path
        d="M13.4 13.2 L21.8 13.2 L18.6 18.8 L10.2 18.8 Z"
        fill="currentColor"
        opacity="0.92"
      />
    </svg>
  );

  if (variant === "mark") {
    return <span className={className} style={{ color: "var(--volt)", display: "inline-flex" }}>{mark}</span>;
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

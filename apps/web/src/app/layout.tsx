/**
 * SENT — root layout.
 *
 * Sets the document shell, the font and the navigation. Everything below is a
 * server component by default; `"use client"` appears only where a component
 * genuinely needs state or an event handler, which for this app is navigation,
 * the trade panel and the live socket.
 */

import type { Metadata, Viewport } from "next";

import { Nav } from "../components/Nav.tsx";
import { Field } from "../components/Field.tsx";
import { Reveal } from "../components/Reveal.tsx";

import "./globals.css";
import type { JSX } from "react";

/**
 * THE FLAG HAS TO BEAT THE FIRST PAINT (§43, §44, §47)
 * ----------------------------------------------------
 * `Reveal` sets `data-motion` from an effect, and an effect runs AFTER the
 * browser has painted. So on a clean load the sequence was: paint the content
 * visible, set the flag, set `data-revealed` in the same synchronous block —
 * and the browser, computing style once at the end, lands on "visible" with no
 * transition to run. Everything above the fold simply appeared. The entrance
 * animation existed and never played, which on a first visit is the only place
 * it matters.
 *
 * Moving it into `useLayoutEffect` is not the fix either: it warns under SSR
 * and still runs after hydration, which on a slow connection is late.
 *
 * So the flag is set here, inline, before the body is parsed. The hidden state
 * applies to the first paint, and `Reveal` then transitions out of it.
 *
 * WHAT KEEPS THIS FROM BEING AN OUTAGE
 * ------------------------------------
 * The hidden state is the dangerous half of this system: anything wearing a
 * motion class is at `opacity: 0` until something reveals it. §44 forbids
 * making a user watch an animation to reach information, and a page stuck at
 * zero opacity is that rule violated absolutely. Two failures are covered:
 *
 *   - JavaScript disabled or blocked entirely. This script never runs, the
 *     flag is never set, and `html:not([data-motion="on"])` keeps every motion
 *     element visible and untransformed. The page is complete.
 *
 *   - This script runs and the React bundle then fails, 404s, or is still in
 *     flight. That is the gap the inline flag opens, so it closes it itself:
 *     if `Reveal` has not marked itself alive within the deadline, the flag
 *     comes back off and the page becomes readable on its own.
 *
 * Reduced motion is checked here too, so the flag is never set at all for a
 * reader who asked for stillness — no hidden state, nothing to reveal.
 */
const MOTION_DEADLINE_MS = 2500;

const MOTION_BOOT = `(function(){try{
if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
var r=document.documentElement;
r.setAttribute("data-motion","on");
setTimeout(function(){
if(r.getAttribute("data-motion-armed")!=="true")r.removeAttribute("data-motion");
},${MOTION_DEADLINE_MS});
}catch(e){}})();`;

export const metadata: Metadata = {
  title: {
    default: "SENT — Launch. Pair. Create Market.",
    template: "%s — SENT",
  },
  description:
    "Permissionless fixed-supply token launches on HyperEVM, quoted against official xStocks.",
  applicationName: "SENT",
  openGraph: {
    title: "SENT — Launch. Pair. Create Market.",
    description:
      "Permissionless fixed-supply token launches on HyperEVM, quoted against official xStocks.",
    siteName: "SENT",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#050607",
  // Zoom is NOT disabled. Locking it out is the standard way an app breaks
  // accessibility for a marginally tidier layout (§84).
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    /*
      `suppressHydrationWarning` covers ONE thing and is placed for it: the boot
      script sets `data-motion` on this element before React hydrates, so the
      server HTML and the live DOM differ by that attribute and React reports a
      mismatch it says it "won't patch up".

      It is scoped to this element's own attributes, not the tree below it, so
      a real mismatch in the page still surfaces. The alternative — rendering
      the attribute server-side — would set the hidden state for readers whose
      JavaScript never arrives, which is the outage the whole arrangement is
      built to avoid.
    */
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sora, per the brand board, with a preconnect so the first paint does
            not wait on a DNS round trip. `display=swap` keeps text visible
            while it loads — a blank heading is worse than a fallback face. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap"
        />

        {/* Before the body, so the hidden state applies to the first paint.
            See MOTION_BOOT above for what happens when it cannot. */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT }} />
      </head>
      <body>
        {/* First stop for a keyboard user, and visible on focus (§84). */}
        <a href="#main" className="sr-only">
          Skip to content
        </a>

        {/*
          The animated background (§46), mounted once at the root.
          
          Once, not per page: it is a space the whole product sits inside, and
          remounting it on every route would restart the camera and make
          navigation feel like a cut rather than a move. It reads trading mode
          off the DOM itself, so it calms down on the terminal without this
          layout knowing which route is active.
        */}
        <Field />

        {/*
          Arms the reveal system (§43, §47). Renders nothing.

          Deliberately mounted AFTER Field and before the content it governs.
          The inline boot script above has already set `data-motion`, so what
          this adds is the reveal itself — and `data-motion-armed`, which is
          how the boot script learns it arrived in time and leaves the hidden
          state in place.
        */}
        <Reveal />

        <Nav />
        <main id="main">{children}</main>
      </body>
    </html>
  );
}

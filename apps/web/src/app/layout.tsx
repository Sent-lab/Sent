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

import "./globals.css";
import type { JSX } from "react";

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
    <html lang="en">
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
      </head>
      <body>
        {/* First stop for a keyboard user, and visible on focus (§84). */}
        <a href="#main" className="sr-only">
          Skip to content
        </a>
        <Nav />
        <main id="main">{children}</main>
      </body>
    </html>
  );
}

"use client";

/**
 * SENT — primary navigation (§212).
 *
 * Explore, Create, Roadmap, Updates, Account. Wallet control separate. That list
 * is §212's recommendation and it is followed exactly — §212 also forbids an
 * overpacked nav and a global command palette, both of which are what happens
 * when a nav is allowed to grow by one item at a time.
 *
 * The current route is marked with `aria-current`, not only with colour. §84
 * does not allow colour to be the sole carrier of state.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Logo } from "./Logo.tsx";

import styles from "./Nav.module.css";
import type { JSX } from "react";

const LINKS = [
  { href: "/explore", label: "Explore" },
  { href: "/create", label: "Create" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/updates", label: "Updates" },
  { href: "/account", label: "Account" },
] as const;

export function Nav(): JSX.Element {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className={styles.header}>
      <nav className={`${styles.inner} container-wide`} aria-label="Primary">
        <Link href="/" className={styles.brand} aria-label="SENT home">
          <Logo size={26} />
          <span className={styles.wordmark}>SENT</span>
        </Link>

        <ul className={styles.links}>
          {LINKS.map((link) => {
            // A prefix match, so /t/0x… does not light up Explore but
            // /explore?sort=… does.
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`${styles.link} ${active ? styles.active : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className={styles.actions}>
          <ConnectButton />

          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((value) => !value)}
          >
            {/* An icon-only control needs a label; §227 forbids a tiny unlabelled
                icon action, and the button itself is sized to the touch target. */}
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <span className={`${styles.bars} ${open ? styles.barsOpen : ""}`} aria-hidden="true" />
          </button>
        </div>
      </nav>

      {/* Rendered always and toggled with `hidden`, so opening the menu does not
          mount a subtree and shift the page (§80). */}
      <div id="mobile-nav" className={styles.mobile} hidden={!open}>
        <ul>
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={styles.mobileLink}
                onClick={() => setOpen(false)}
                aria-current={pathname === link.href ? "page" : undefined}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

/**
 * Wallet control.
 *
 * Deliberately not wired to a connector yet. §694 requires that what a user
 * reviews is byte-for-byte what they sign, and the intent builder that
 * guarantees it lives in `@sent/sdk` — connecting a wallet before that path is
 * complete would produce a button that can sign something the review never
 * showed. It renders as unavailable rather than as a working control that fails.
 */
function ConnectButton(): JSX.Element {
  return (
    <button type="button" className={styles.connect} disabled title="Wallet connection is not enabled in this build">
      Connect
    </button>
  );
}

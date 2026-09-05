"use client";

/**
 * SENT — sharing a market (§68).
 *
 * §68 calls share part of the acquisition loop. The preview card has existed
 * for a while and carries everything that section asks for — ticker, pair,
 * market cap, graduation progress, the mark — and nothing on the page shared it.
 *
 * THREE SURFACES, AND NOTHING CLEVER
 * ----------------------------------
 * Copy link, X, Telegram. Each is the platform's own documented share URL
 * opened in a new tab, which means the post is composed in the user's own
 * session on the user's own account. No API keys, no OAuth, nothing of ours
 * standing between the user and the thing they are posting to.
 *
 * `navigator.share` is deliberately not used even where it exists: it hides
 * which surface is being posted to behind an OS sheet, and on desktop it is
 * absent, so the three buttons have to exist anyway.
 *
 * WIDTH IS RESERVED, NOT DISCOVERED (§48)
 * ---------------------------------------
 * "Copy link" becomes "Copied" and back. §48 requires a button to hold its
 * width when its text changes, so the label sits in a grid cell with both
 * strings stacked and only one visible — the box is sized to the longest of
 * them from the first render and never moves.
 *
 * That is the same mechanism the trade panel needs and, until this component,
 * nowhere had.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import styles from "./ShareMarket.module.css";

export interface ShareMarketProps {
  readonly symbol: string;
  readonly name: string;
  readonly quoteSymbol: string;
  readonly token: string;
}

/** How long "Copied" stays before the label returns. */
const COPIED_MS = 1_800;

export function ShareMarket({
  symbol,
  name,
  quoteSymbol,
  token,
}: ShareMarketProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The canonical URL, not `location.href`: a market reached with a filter or a
  // tracking parameter should not pass that on to everyone it is shared with.
  const [url, setUrl] = useState(`/t/${token}`);

  useEffect(() => {
    setUrl(`${window.location.origin}/t/${token}`);
  }, [token]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      /*
       * Clipboard access can be refused — an insecure origin, a permission
       * policy, a browser that wants a user gesture it did not see. Saying
       * nothing is wrong: the link is visible in the address bar and the user
       * can still copy it themselves. A toast reading "could not copy" would be
       * reporting our failure at somebody trying to share.
       */
    }
  }, [url]);

  const text = `${symbol} — ${name}, quoted against ${quoteSymbol} on SENT`;

  return (
    <div className={styles.share} role="group" aria-label={`Share ${symbol}`}>
      <button type="button" className={styles.button} onClick={() => void copy()}>
        {/*
          Both labels are laid on top of each other in one grid cell, so the
          button is as wide as the longer from the first paint (§48).
        */}
        <span className={styles.swap} aria-hidden="true">
          <span data-shown={!copied}>Copy link</span>
          <span data-shown={copied}>Copied</span>
        </span>
        <span className="sr-only">{copied ? "Link copied" : "Copy link"}</span>
      </button>

      <a
        className={styles.button}
        href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Share on X
      </a>

      <a
        className={styles.button}
        href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Telegram
      </a>
    </div>
  );
}

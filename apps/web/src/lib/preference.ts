"use client";

/**
 * SENT — settings that survive a page (§62).
 *
 * §62: "important settings tidak reset secara random", and names slippage
 * preference, chart timeframe, amount presets and panel state. Slippage reset
 * to 1% and the chart to 5m on every mount, so a trader who set either had to
 * set it again on the next market they opened — and on the same market after a
 * refresh.
 *
 * WHY IT CANNOT SIMPLY READ localStorage AT INITIALISATION
 * --------------------------------------------------------
 * These pages are server-rendered. A `useState` initialiser that read storage
 * would produce different HTML on the server (no storage) and the client (a
 * stored value), and React would report a hydration mismatch and discard the
 * server tree.
 *
 * So the default is used for the first render on both sides, and the stored
 * value is applied in an effect immediately afterwards. That costs one extra
 * paint at a preference the user already chose, which is the correct thing to
 * trade for a tree that hydrates.
 *
 * WHY EVERY ACCESS IS GUARDED
 * ---------------------------
 * `localStorage` is not merely absent in some contexts — the accessor itself
 * throws: a private window with site data blocked, an embedded frame under a
 * restrictive permission policy, a browser configured to refuse storage. A read
 * that throws during render would take the page down over a remembered
 * dropdown, so every read and write is wrapped and a failure means "no
 * preference", never an error.
 *
 * WHAT DOES NOT BELONG HERE
 * -------------------------
 * Anything another person or another device has to see, and anything that must
 * be recoverable. This is per-browser convenience. §86's cross-device
 * continuity is a different mechanism and explicitly excludes "critical
 * transactional drafts".
 */

import { useCallback, useEffect, useState } from "react";

const PREFIX = "sent.pref.";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* Storage refused. The preference simply does not persist. */
  }
}

/**
 * State that remembers itself in this browser.
 *
 * @param key      Stable across releases — changing it silently forgets.
 * @param fallback Used for the first render on server and client alike.
 * @param decode   Parses a stored string. Return null to reject it, which is
 *                 what keeps a hand-edited or stale value from reaching state.
 * @param encode   Serialises for storage.
 */
export function usePreference<T>(
  key: string,
  fallback: T,
  decode: (raw: string) => T | null,
  encode: (value: T) => string,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    const raw = read(key);
    if (raw === null) return;

    const parsed = decode(raw);
    // A rejected value is left alone rather than cleared: it may belong to a
    // newer release this tab has not loaded yet.
    if (parsed !== null) setValue(parsed);
    // `decode` is a fresh closure each render; depending on it would re-read
    // storage forever and stamp over whatever the user just chose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T): void => {
      setValue(next);
      write(key, encode(next));
      // Same reason as above.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [key],
  );

  return [value, set];
}

/** Decimal-string bigints: slippage in basis points, and anything like it. */
export function decodeBigint(allowed: readonly bigint[]): (raw: string) => bigint | null {
  return (raw) => {
    if (!/^\d+$/.test(raw)) return null;
    const value = BigInt(raw);
    // Only values the UI actually offers. A stored 9999 would otherwise arrive
    // as a slippage nobody selected and no control could show.
    return allowed.includes(value) ? value : null;
  };
}

/** Whole numbers from a known set: chart intervals, and anything like them. */
export function decodeNumber(allowed: readonly number[]): (raw: string) => number | null {
  return (raw) => {
    const value = Number(raw);
    return Number.isInteger(value) && allowed.includes(value) ? value : null;
  };
}

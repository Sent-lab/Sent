"use client";

/**
 * SENT — the one global notice this app is allowed (§211, §693).
 *
 * §211 is explicit that a page-wide warning for one stale panel teaches people
 * to dismiss warnings, which is why freshness is rendered beside the data it
 * describes and nowhere else. It leaves exactly one exception: a system-wide
 * issue. This is that exception and nothing else uses it.
 *
 * `/health` answers `serving: false` when the projection is too far behind to
 * be trusted for a trading decision. The endpoint has always said so and
 * nothing asked — so a user could be reading minute-old prices with every
 * panel's badge reporting the freshness of a response that was itself stale.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not block anything. Quotes are read live at signing time and a trade
 * prices correctly however far behind the projection is; the risk is a decision
 * made on an old chart, not a bad fill. So this is a line of text, not a modal
 * and not a disabled interface — §44 forbids standing between a user and the
 * thing they came to do, and being behind is not a reason to.
 *
 * It also does not report the socket. `useLive` already carries connection
 * state to the surfaces that stream, and a second indicator for a different
 * failure would be two things a user has to tell apart in the same corner.
 *
 * POLLED, AND ONLY WHILE ANYONE IS LOOKING
 * ----------------------------------------
 * A background tab polling a health endpoint forever is a request per user per
 * interval for an answer nobody reads. It stops when the document is hidden and
 * asks once more on return, which is also the moment the answer is most likely
 * to have changed.
 */

import { useCallback, useEffect, useState, type JSX } from "react";

import { getHealth, isOk } from "../lib/api.ts";

import styles from "./ServiceNotice.module.css";

/** Slow: this is a fallback for a condition that lasts minutes, not seconds. */
const POLL_MS = 30_000;

export function ServiceNotice(): JSX.Element | null {
  const [behind, setBehind] = useState<{ lagBlocks: number } | null>(null);

  const check = useCallback(async (signal: AbortSignal): Promise<void> => {
    const result = await getHealth({ signal }).catch(() => null);
    if (signal.aborted) return;

    /*
     * A failed health check says nothing.
     *
     * The API being unreachable is already visible: every panel shows its own
     * reconnecting state, from its own request. Adding a banner for it would
     * report the same outage twice and in a place the user cannot act on.
     */
    if (result === null || !isOk(result)) return;

    setBehind(result.data.serving ? null : { lagBlocks: result.data.lagBlocks });
  }, []);

  useEffect(() => {
    let controller = new AbortController();
    void check(controller.signal);

    const timer = setInterval(() => {
      if (document.hidden) return;
      controller.abort();
      controller = new AbortController();
      void check(controller.signal);
    }, POLL_MS);

    const onVisible = (): void => {
      if (document.hidden) return;
      controller.abort();
      controller = new AbortController();
      void check(controller.signal);
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      controller.abort();
    };
  }, [check]);

  if (behind === null) return null;

  return (
    <div className={styles.notice} role="status">
      <span className={styles.dot} aria-hidden="true" />
      <span>
        Market data is {behind.lagBlocks.toLocaleString("en-US")} blocks behind the chain
        and is not current enough to act on. Quotes are still read live, so a trade prices
        correctly — but prices and charts on this page are older than they look.
      </span>
    </div>
  );
}

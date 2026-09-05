"use client";

/**
 * SENT — the mobile trade dock (§85, §227).
 *
 * §85 gives mobile its own composition and puts a STICKY BUY / SELL above the
 * trade sheet in its priority list. The terminal did the opposite: below
 * 1080px the trade panel stopped being sticky and became just another block, so
 * scrolling to the chart — the thing §85 puts first — took the only action off
 * the screen.
 *
 * That was a deliberate fix for a real problem, and its reasoning is still in
 * `terminal.module.css`: a sticky PANEL on a short viewport covers the content
 * it is meant to accompany. The answer §85 gives is to make the ACTIONS sticky
 * rather than the panel, and put the form in a sheet the actions open.
 *
 * WHY A NATIVE `dialog`
 * ---------------------
 * A modal has to trap focus, return it on close, respond to Escape, and make
 * the page behind it inert. Hand-rolling those is how a trade form ends up
 * letting a keyboard user tab into the chart behind it while a signature is
 * pending. `showModal()` gives all four from the platform, and `::backdrop` is
 * a real element rather than a div pretending.
 *
 * THE PANEL MOUNTS WITH THE SHEET, NOT WITH THE PAGE
 * --------------------------------------------------
 * The desktop aside is hidden below the breakpoint by CSS, and this renders its
 * own `TradePanel` only while the sheet is open. So there is never a second
 * live panel debouncing quotes behind a hidden element — the cost of the sheet
 * is paid when it is opened and returned when it is closed.
 *
 * A closed sheet also means the input is unmounted, so a half-typed amount does
 * not survive a dismissal. That is the correct behaviour: the sheet is opened
 * from a BUY or a SELL button, and an amount left over from the other side is
 * the kind of thing that gets signed by accident.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { TradePanel, type Side } from "./TradePanel.tsx";
import type { MarketStatus } from "./GraduationProgress.tsx";
import type { FreshnessEnvelope } from "@sent/realtime";

import styles from "./MobileTradeDock.module.css";

export interface MobileTradeDockProps {
  readonly token: string;
  readonly market: string;
  readonly quoteAsset: string;
  readonly symbol: string;
  readonly quoteSymbol: string;
  readonly quoteDecimals: number;
  readonly status: MarketStatus;
  readonly pool: string | null;
  readonly freshness: FreshnessEnvelope;
}

export function MobileTradeDock(props: MobileTradeDockProps): JSX.Element {
  const [side, setSide] = useState<Side | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const open = useCallback((next: Side): void => {
    setSide(next);
  }, []);

  const close = useCallback((): void => {
    setSide(null);
  }, []);

  /*
   * `showModal` is imperative, so the element is driven from the state rather
   * than the other way round. Calling it on an already-open dialog throws, and
   * calling `close` on a closed one is a no-op, so both are guarded.
   */
  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;

    if (side !== null && !el.open) el.showModal();
    if (side === null && el.open) el.close();
  }, [side]);

  /*
   * Escape and the backdrop both close, and both go through the same state.
   *
   * `cancel` fires for Escape; without adopting it, the dialog would close
   * itself while this component still believed it was open, and the next tap on
   * BUY would do nothing.
   */
  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;

    const onCancel = (event: Event): void => {
      event.preventDefault();
      close();
    };

    el.addEventListener("cancel", onCancel);
    el.addEventListener("close", close);

    return () => {
      el.removeEventListener("cancel", onCancel);
      el.removeEventListener("close", close);
    };
  }, [close]);

  const graduated = props.status === "GRADUATED";
  const graduating = props.status === "GRADUATING";
  const closed = graduated || graduating;

  return (
    <>
      {/*
        Below the breakpoint only — the desktop aside is the panel there, and
        two ways to trade on one screen is one too many.
      */}
      <div className={styles.dock} data-closed={closed ? "true" : undefined}>
        {closed ? (
          <p className={styles.dockNotice}>
            {graduated
              ? `Trading has moved to the ${props.quoteSymbol} pool.`
              : "The curve is closed while this market graduates."}
          </p>
        ) : (
          <>
            <button
              type="button"
              className={styles.buy}
              onClick={() => open("BUY")}
              aria-haspopup="dialog"
            >
              Buy {props.symbol}
            </button>
            <button
              type="button"
              className={styles.sell}
              onClick={() => open("SELL")}
              aria-haspopup="dialog"
            >
              Sell
            </button>
          </>
        )}
      </div>

      <dialog ref={dialog} className={styles.sheet} aria-label={`Trade ${props.symbol}`}>
        {/*
          Rendered only while open. A closed sheet holds no panel, so nothing
          polls for a quote behind a dismissed form.
        */}
        {side !== null && (
          <div className={styles.sheetInner}>
            <div className={styles.sheetHead}>
              {/* A grab handle that is also the close control: the gesture and
                  the button are the same affordance, which is what a sheet on a
                  touch device is expected to be. */}
              <button type="button" className={styles.close} onClick={close}>
                <span className={styles.grabber} aria-hidden="true" />
                <span className="sr-only">Close trade sheet</span>
              </button>
            </div>

            <TradePanel {...props} initialSide={side} />
          </div>
        )}
      </dialog>
    </>
  );
}

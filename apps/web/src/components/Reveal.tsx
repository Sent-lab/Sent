"use client";

/**
 * SENT — the reveal system (§43, §44, §47).
 *
 * Marks `[data-motion="on"]` on the root and reveals `.m-primary`,
 * `.m-secondary` and `.m-ambient` elements as they enter the viewport.
 *
 * WHO OWNS THE HIDDEN STATE
 * -------------------------
 * Not this component. The hidden state in `globals.css` is scoped to
 * `html[data-motion="on"]`, and that flag is set by an inline script in the
 * root layout before the first paint — because an effect runs after the paint,
 * and a reveal that starts from an already-visible element has nothing to
 * animate.
 *
 * What this component owns is the reveal, and `data-motion-armed`: the signal
 * that tells the boot script its deadline can stop counting. If this bundle
 * never arrives, that deadline expires, the flag comes off, and the page
 * becomes readable without it. §44 forbids making a user watch an animation to
 * reach information, and a page stuck at zero opacity is that rule violated
 * absolutely — so no single point in this chain is allowed to be the one that
 * keeps content hidden.
 *
 * WHY ONE OBSERVER AND NOT A HOOK PER SECTION
 * -------------------------------------------
 * A `useInView` on every element means an observer per element, each with its
 * own callback and its own React state update. On an explore page with
 * twenty-five cards that is twenty-five re-renders during a scroll. One
 * observer mutating `data-revealed` directly touches React not at all — the
 * reveal is a presentational fact about a DOM node, and routing it through
 * state buys nothing and costs frames.
 *
 * WHY IT WATCHES FOR NEW NODES
 * ----------------------------
 * A single pass at mount is a trap with a long fuse. Content that arrives later
 * — a tape row streaming in, an explore grid re-rendered under a new filter, a
 * panel that mounts on a wallet connection — would carry the class, inherit
 * `opacity: 0`, and never be observed by anything. It would be INVISIBLE, and
 * invisible in a way that looks like a data bug rather than a motion bug: the
 * row is in the DOM, has its content, and cannot be seen.
 *
 * So a MutationObserver arms whatever appears. The cost is one cheap check per
 * added element; the alternative is a rule every future contributor has to know
 * and the fifth person to add a live list will not.
 *
 * STAGGER IS COMPUTED, NOT AUTHORED
 * ---------------------------------
 * Siblings revealing together get an increasing delay, so a row of cards
 * arrives as a sequence rather than a block. Authoring that as per-element
 * delays would mean every new card needing a hand-picked number, and the fifth
 * person to add one would forget.
 */

import { useEffect, type JSX } from "react";

/** Ceiling on the stagger, so a long list does not trail off for seconds. */
const MAX_STAGGER_MS = 320;

/** Per-sibling step. Small: the eye reads sequence long before it reads delay. */
const STAGGER_STEP_MS = 55;

const SELECTOR = ".m-primary, .m-secondary, .m-ambient";

export function Reveal(): JSX.Element | null {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    /*
     * Reduced motion never arms the system.
     *
     * The flag is not set, so the CSS keeps everything visible and untransformed
     * and there is nothing to animate. That is stronger than setting durations
     * to zero: with no flag there is no transition to shorten, no observer, and
     * no work per scroll.
     */
    if (reduced.matches) return;

    /*
     * Set both, in this order.
     *
     * `data-motion` is normally already on — the inline boot script in the
     * root layout sets it before the first paint. It is set again here because
     * this component must work whether or not that script ran: with no script
     * the flag arrives late and the reveal is instant rather than animated,
     * which is a lesser outcome and not a broken one.
     *
     * `data-motion-armed` is the signal the boot script waits for. Until it
     * appears the script's deadline is still counting down, ready to strip the
     * flag and make the page readable if this bundle never arrives.
     */
    root.setAttribute("data-motion", "on");
    root.setAttribute("data-motion-armed", "true");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          const el = entry.target as HTMLElement;
          el.setAttribute("data-revealed", "true");

          // Once revealed, stop watching. Re-hiding on scroll-up is a pattern
          // that reads as a glitch: the user has already seen the content and
          // watching it leave and return is worse than it simply being there.
          observer.unobserve(el);
        }
      },
      {
        /*
         * Fire slightly before the element is fully on screen, and require a
         * sliver of it to be visible.
         *
         * `-8%` on the bottom means the reveal starts as the element crosses
         * into view rather than after it has sat there — which is the
         * difference between content that arrives and content that pops.
         */
        rootMargin: "0px 0px -8% 0px",
        threshold: 0.01,
      },
    );

    /*
     * Stagger is assigned per parent, and the counter outlives a single pass.
     *
     * Keeping it here rather than in the intersection callback means the delay
     * is a property of where an element sits, not of the order the observer
     * happened to fire — which on a fast scroll is not the order they appear.
     * Because the map persists, a list that grows continues its sequence
     * instead of restarting from zero halfway down.
     */
    const seen = new Map<Element, number>();

    function arm(elements: readonly HTMLElement[], immediate: boolean): void {
      for (const el of elements) {
        // Already handled. Re-arming would reset a completed reveal, and a
        // MutationObserver fires for attribute-driven moves as well as inserts.
        if (el.hasAttribute("data-revealed")) continue;

        const parent = el.parentElement;
        if (parent !== null) {
          const index = seen.get(parent) ?? 0;
          seen.set(parent, index + 1);

          if (index > 0) {
            const delay = Math.min(index * STAGGER_STEP_MS, MAX_STAGGER_MS);
            el.style.setProperty("--reveal-delay", `${delay}ms`);
          }
        }

        /*
         * Above-the-fold content at FIRST paint reveals synchronously.
         *
         * IntersectionObserver does fire for already-intersecting targets, but
         * on the next frame — which on a fast first paint is a visible flash of
         * the hero being absent.
         *
         * This applies only to the initial pass. An element inserted later is
         * usually inserted in view, and revealing it instantly would mean the
         * one case where the motion is actually communicating something — new
         * content arriving — is the one case with no motion.
         */
        if (immediate && el.getBoundingClientRect().top < window.innerHeight * 0.9) {
          el.setAttribute("data-revealed", "true");
          continue;
        }

        observer.observe(el);
      }
    }

    arm([...document.querySelectorAll<HTMLElement>(SELECTOR)], true);

    /*
     * A PAGE LOADED OUT OF SIGHT HAS NO VIEWPORT TO BE ABOVE THE FOLD OF
     * ---------------------------------------------------------------------
     * Opening a link in a background tab, restoring a session, or being
     * prerendered all run this effect against a document the browser has not
     * laid out. `innerHeight` is zero, so nothing qualifies for the immediate
     * pass, and IntersectionObserver has a zero-area viewport to intersect
     * with — so it reports nothing either.
     *
     * Both of the systems that reveal content are therefore silent, every
     * target stays at `opacity: 0`, and the boot script's deadline does not
     * help: the bundle arrived, it is just looking at a page with no size.
     * The user switches to the tab and finds a blank column.
     *
     * So visibility is a trigger in its own right. When the document is shown,
     * anything on screen and still unrevealed is revealed — with the
     * transition, because it is being seen for the first time.
     */
    function sweep(): void {
      if (document.hidden) return;

      const fold = window.innerHeight;
      if (fold === 0) return;

      for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
        if (el.hasAttribute("data-revealed")) continue;
        if (el.getBoundingClientRect().top >= fold) continue;

        el.setAttribute("data-revealed", "true");
        observer.unobserve(el);
      }
    }

    document.addEventListener("visibilitychange", sweep);

    /*
     * Everything that appears from here on is armed too.
     *
     * An inserted node may itself carry a motion class, contain some, or both,
     * so each addition is checked as well as searched.
     */
    const mutations = new MutationObserver((records) => {
      const found: HTMLElement[] = [];

      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          if (node.matches(SELECTOR)) found.push(node);
          found.push(...node.querySelectorAll<HTMLElement>(SELECTOR));
        }
      }

      if (found.length > 0) arm(found, false);
    });

    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("visibilitychange", sweep);
      observer.disconnect();
      mutations.disconnect();

      /*
       * The flag comes off with the component.
       *
       * It is what makes the hidden state apply, so leaving it set after the
       * observers are gone would hide any motion element that mounts
       * afterwards with nothing left to reveal it.
       */
      root.removeAttribute("data-motion");
      root.removeAttribute("data-motion-armed");
    };
  }, []);

  return null;
}

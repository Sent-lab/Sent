"use client";

/**
 * SENT — the reveal system (§43, §44, §47).
 *
 * Marks `[data-motion="on"]` on the root and reveals `.m-primary`,
 * `.m-secondary` and `.m-ambient` elements as they enter the viewport.
 *
 * WHY THE FLAG ON THE ROOT COMES FIRST
 * ------------------------------------
 * The hidden state in `globals.css` is scoped to `html[data-motion="on"]`, so
 * until this component runs, nothing is hidden. That ordering is the whole
 * safety property: if the bundle fails, is blocked, or simply has not arrived,
 * the page renders complete and readable instead of a column of invisible
 * sections. §44 forbids making a user watch an animation to reach information;
 * a page that is permanently blank without JavaScript is the extreme case of
 * exactly that.
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

    const targets = document.querySelectorAll<HTMLElement>(
      ".m-primary, .m-secondary, .m-ambient",
    );

    if (targets.length === 0) return;

    root.setAttribute("data-motion", "on");

    /*
     * Stagger is assigned per parent, before observation.
     *
     * Doing it here rather than in the callback means the delay is a property of
     * where an element sits, not of the order the observer happened to fire —
     * which on a fast scroll is not the order they appear.
     */
    const seen = new Map<Element, number>();

    for (const el of targets) {
      const parent = el.parentElement;
      if (parent === null) continue;

      const index = seen.get(parent) ?? 0;
      seen.set(parent, index + 1);

      if (index > 0) {
        const delay = Math.min(index * STAGGER_STEP_MS, MAX_STAGGER_MS);
        el.style.setProperty("--reveal-delay", `${delay}ms`);
      }
    }

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

    for (const el of targets) observer.observe(el);

    /*
     * Anything already on screen at mount reveals immediately.
     *
     * IntersectionObserver does fire for already-intersecting targets, but on
     * the next frame — which on a fast first paint is a visible flash of the
     * hero being absent. Revealing above-the-fold content synchronously removes
     * that, and the observer's later callback is a harmless no-op because the
     * element is already unobserved.
     */
    const fold = window.innerHeight;
    for (const el of targets) {
      if (el.getBoundingClientRect().top < fold * 0.9) {
        el.setAttribute("data-revealed", "true");
        observer.unobserve(el);
      }
    }

    return () => observer.disconnect();
  }, []);

  return null;
}

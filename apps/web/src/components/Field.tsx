"use client";

/**
 * SENT — the animated background (§46).
 *
 * WHAT IT IS
 * ----------
 * A volumetric lattice: a three-dimensional grid of nodes projected to the
 * screen, with the camera drifting forward through it forever. Nodes near the
 * camera are larger and brighter; distant ones fade into the ground colour.
 * Neighbours within a distance threshold are joined, so the field reads as a
 * STRUCTURE moving past you rather than as particles.
 *
 * That distinction is the whole design. §43 explicitly rules out "random
 * particles" and "generic gradient animation", and the reason is that both
 * read as decoration. A lattice reads as depth — the eye accepts it as a space
 * the page is sitting inside, which is what makes a background feel expensive
 * rather than busy.
 *
 * WHAT IT RESPONDS TO (§46)
 * -------------------------
 *   scroll    adds to the camera's forward velocity, so scrolling moves you
 *             through the field instead of past a picture of one.
 *   pointer   tilts the projection. Not a parallax layer slide — the whole
 *             lattice re-projects, so the depth cue is consistent at every z.
 *   mode      trading mode drops the energy floor hard (§39.2, §47): when a
 *             user is deciding on a trade, ambient motion is the first thing
 *             that should get out of the way.
 *   energy    market state, 0..1. Feeds density, drift speed and how many
 *             connections light up. A quiet protocol has a quiet background.
 *
 * WHY CANVAS 2D AND NOT WEBGL
 * ---------------------------
 * §45 allows 3D and warns in the same breath that "3D tidak boleh menjadi demo
 * teknologi". This effect needs perhaps 600 projected points and some lines;
 * a WebGL context, a shader pipeline and a 150KB dependency to draw that would
 * be technology for its own sake, and it would cost every visitor the download.
 * 2D canvas does it in one file with no dependency and degrades on a slow
 * device by simply drawing fewer nodes.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * §46's rules are constraints, not aspirations, so each has a mechanism:
 *
 *   no layout shift        fixed, behind everything, never in flow
 *   no GPU overload        node count is capped and adapts to measured frame
 *                          time; the loop stops entirely when the tab is hidden
 *   readability preserved  it never exceeds ~6% luminance over the ground
 *   reduced motion         one static frame, then the loop never starts
 */

import { useEffect, useRef, type JSX } from "react";

import styles from "./Field.module.css";

export interface FieldProps {
  /**
   * Ambient energy, 0..1. Market-derived where a caller has it.
   *
   * Deliberately a number rather than a boolean "busy": §89 wants the visual
   * system to react to market state continuously, and a two-state background
   * would jump between looks at whatever threshold someone picked.
   */
  readonly energy?: number;
}

/** One node in the lattice. `z` is depth; the camera sits at z = 0 looking +z. */
interface Node {
  x: number;
  y: number;
  z: number;
  /** Per-node phase so the drift is not visibly synchronised. */
  seed: number;
}

/** How far into the field the camera can see. Beyond this, nodes are invisible. */
const DEPTH = 1400;

/** Projection strength. Larger reads as a longer lens — flatter, calmer. */
const FOCAL = 620;

/** Nodes closer than this in projected space get a connecting line. */
const LINK_DISTANCE = 132;

/**
 * Frame budget in milliseconds.
 *
 * 12ms rather than 16.7: the background must not be the reason a page misses a
 * frame, so it gives itself only part of the budget and sheds nodes when it
 * exceeds that. §83 makes performance a UX requirement rather than a nicety.
 */
const FRAME_BUDGET_MS = 12;

export function Field({ energy = 0.35 }: FieldProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const energyRef = useRef(energy);

  // Kept in a ref so a changing prop does not tear down and rebuild the field.
  energyRef.current = energy;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (ctx === null) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    /*
     * Node budget, from viewport area rather than a fixed number.
     *
     * A phone and a 4K monitor both want the field to look the same DENSITY,
     * not to contain the same count — a fixed number is sparse on one and
     * expensive on the other.
     */
    const targetCount = (): number => {
      const area = window.innerWidth * window.innerHeight;
      const byArea = Math.round(area / 5200);
      const cap = window.innerWidth < 720 ? 130 : 520;
      return Math.max(40, Math.min(byArea, cap));
    };

    let nodes: Node[] = [];
    let budget = targetCount();

    const spawn = (count: number): void => {
      nodes = Array.from({ length: count }, () => ({
        x: (Math.random() - 0.5) * 2400,
        y: (Math.random() - 0.5) * 1600,
        z: Math.random() * DEPTH,
        seed: Math.random() * Math.PI * 2,
      }));
    };

    spawn(budget);

    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = (): void => {
      // Capped at 2: beyond that the extra pixels are invisible on a field this
      // dim and cost real fill rate on high-DPI laptops.
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const next = targetCount();
      if (Math.abs(next - budget) > budget * 0.25) {
        budget = next;
        spawn(budget);
      }
    };

    resize();

    /* -------------------------------------------------------------------- */
    /* Input                                                                 */
    /* -------------------------------------------------------------------- */

    // Targets are what input sets; the rendered values chase them. Every
    // response is therefore inertial rather than instantaneous, which is what
    // §43 means by "spring behavior" — a background that snaps to the cursor
    // feels like a widget, not a space.
    let tiltTargetX = 0;
    let tiltTargetY = 0;
    let tiltX = 0;
    let tiltY = 0;

    let scrollBoostTarget = 0;
    let scrollBoost = 0;
    let lastScrollY = window.scrollY;

    const onPointer = (event: PointerEvent): void => {
      tiltTargetX = (event.clientX / width - 0.5) * 2;
      tiltTargetY = (event.clientY / height - 0.5) * 2;
    };

    const onScroll = (): void => {
      const delta = window.scrollY - lastScrollY;
      lastScrollY = window.scrollY;
      // Clamped: a trackpad fling should accelerate the field, not launch it.
      scrollBoostTarget = Math.max(-2.4, Math.min(delta * 0.05, 2.4));
    };

    /*
     * Trading mode reads from the DOM rather than from a prop.
     *
     * The mode is already expressed as `[data-mode]` on a container (§39), and
     * threading it down as a second source of truth is how the two drift apart.
     * Re-read each frame; it is one attribute lookup.
     */
    const tradingActive = (): boolean =>
      document.querySelector('[data-mode="trading"]') !== null;

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    /* -------------------------------------------------------------------- */
    /* Render                                                                */
    /* -------------------------------------------------------------------- */

    interface Projected {
      sx: number;
      sy: number;
      /** 0 at the far plane, 1 at the camera. Drives size and alpha. */
      near: number;
    }

    const projected: Projected[] = [];

    const draw = (dt: number, time: number): void => {
      const trading = tradingActive();

      // Trading mode compresses the whole energy range rather than switching it
      // off. A background that vanishes on one route reads as a bug; one that
      // calms down reads as the product paying attention.
      const raw = Math.max(0, Math.min(energyRef.current, 1));
      const e = trading ? raw * 0.28 : raw;

      // Chase the input targets. The constants are the spring: fast enough to
      // feel connected, slow enough that nothing twitches.
      tiltX += (tiltTargetX - tiltX) * Math.min(1, dt * 0.0026);
      tiltY += (tiltTargetY - tiltY) * Math.min(1, dt * 0.0026);
      scrollBoost += (scrollBoostTarget - scrollBoost) * Math.min(1, dt * 0.004);
      scrollBoostTarget *= 0.94;

      const driftBase = 0.028 + e * 0.05;
      const drift = (driftBase + scrollBoost * 0.09) * dt;

      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;

      // Tilt is applied in world space before projection, so near nodes swing
      // further than far ones for free. Faking it with a CSS translate on a
      // layer would move everything by the same amount and read as flat.
      const tx = tiltX * 210;
      const ty = tiltY * 150;

      projected.length = 0;

      for (const node of nodes) {
        node.z -= drift;

        // Recycle past the camera. Re-randomising x and y as well as z stops a
        // visible "tunnel" forming from nodes returning on the same rays.
        if (node.z <= 1) {
          node.z += DEPTH;
          node.x = (Math.random() - 0.5) * 2400;
          node.y = (Math.random() - 0.5) * 1600;
        }

        const scale = FOCAL / node.z;

        // A slow lateral breath, phase-shifted per node. Without it the lattice
        // is rigid and reads as a screensaver; with it the field feels alive
        // without anything actually moving very far.
        const breath = Math.sin(time * 0.00013 + node.seed) * 26 * (0.4 + e);

        const sx = cx + (node.x + tx + breath) * scale;
        const sy = cy + (node.y + ty) * scale;

        if (sx < -80 || sx > width + 80 || sy < -80 || sy > height + 80) continue;

        projected.push({ sx, sy, near: 1 - node.z / DEPTH });
      }

      /*
       * Connections first, so nodes sit on top of the lines they anchor.
       *
       * O(n²) is honest here: the projected list is capped in the hundreds and
       * the inner loop starts at i+1, so the worst case is well inside the
       * frame budget. A spatial hash would be faster and would be the wrong
       * trade — more code, more state, for a cost that is already paid.
       */
      const linkAlpha = (trading ? 0.05 : 0.13) * (0.35 + e);

      if (linkAlpha > 0.008) {
        ctx.lineWidth = 1;

        for (let i = 0; i < projected.length; i++) {
          const a = projected[i]!;
          if (a.near < 0.25) continue;

          for (let j = i + 1; j < projected.length; j++) {
            const b = projected[j]!;
            const dx = a.sx - b.sx;
            const dy = a.sy - b.sy;
            const d2 = dx * dx + dy * dy;

            if (d2 > LINK_DISTANCE * LINK_DISTANCE) continue;

            const closeness = 1 - Math.sqrt(d2) / LINK_DISTANCE;
            const depth = (a.near + b.near) * 0.5;

            ctx.strokeStyle = `rgba(198, 246, 0, ${linkAlpha * closeness * depth})`;
            ctx.beginPath();
            ctx.moveTo(a.sx, a.sy);
            ctx.lineTo(b.sx, b.sy);
            ctx.stroke();
          }
        }
      }

      for (const p of projected) {
        const r = 0.4 + p.near * 1.7;
        // Cubed so the far field falls away steeply. A linear ramp leaves the
        // distance looking like grey noise instead of distance.
        const alpha = (trading ? 0.18 : 0.4) * p.near * p.near * p.near * (0.45 + e);

        ctx.fillStyle = `rgba(232, 255, 120, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    /* -------------------------------------------------------------------- */
    /* Loop                                                                  */
    /* -------------------------------------------------------------------- */

    let raf = 0;
    let last = performance.now();
    let slowFrames = 0;

    const tick = (now: number): void => {
      // Clamped so a backgrounded tab returning does not integrate one enormous
      // step and teleport the whole field.
      const dt = Math.min(now - last, 48);
      last = now;

      const started = performance.now();
      draw(dt, now);
      const cost = performance.now() - started;

      /*
       * Shed load when frames get expensive, and never grow back.
       *
       * Ratcheting down only is deliberate: a field that oscillates between
       * densities as the device warms and cools is more distracting than a
       * slightly sparser one, and the user cannot tell 400 nodes from 320.
       */
      if (cost > FRAME_BUDGET_MS) {
        slowFrames++;
        if (slowFrames > 20 && nodes.length > 60) {
          nodes = nodes.slice(0, Math.floor(nodes.length * 0.75));
          slowFrames = 0;
        }
      } else if (slowFrames > 0) {
        slowFrames--;
      }

      raf = requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (raf !== 0 || reduced.matches) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const stop = (): void => {
      if (raf === 0) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    // A field animating behind a tab nobody is looking at is pure battery cost.
    const onVisibility = (): void => {
      if (document.hidden) stop();
      else start();
    };

    const onReducedChange = (): void => {
      if (reduced.matches) {
        stop();
        draw(0, performance.now());
      } else {
        start();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onReducedChange);

    if (reduced.matches) {
      // One frame, then nothing. The composition survives; the motion does not.
      // §84 treats this as a requirement rather than a courtesy.
      draw(0, performance.now());
    } else {
      start();
    }

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onReducedChange);
    };
  }, []);

  return (
    <div className={styles.wrap} aria-hidden="true">
      <canvas ref={canvasRef} className={styles.canvas} />
      <div className={styles.vignette} />
    </div>
  );
}

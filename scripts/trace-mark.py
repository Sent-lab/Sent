#!/usr/bin/env python3
"""
Derive the SENT mark's geometry from the official artwork.

WHY THIS EXISTS
---------------
The mark in `apps/web/src/components/Logo.tsx` was once drawn by eye and did not
match — three flat slabs where the real mark is two stepped diagonal forms. The
artwork is in the repository, so the shape can be measured instead of
remembered, and this is the measurement.

Run it when the artwork changes. It prints the two paths in the same form
`Logo.tsx` and `services/api/src/preview.ts` hold them.

    pip install pillow numpy scipy
    python scripts/trace-mark.py

SOURCE, IN ORDER OF PREFERENCE
------------------------------
`Logo SENT.png` is the official export: transparent background, no glow, no
surrounding board. The mask is then simply "alpha > 0", which has no threshold
to tune and no halo to exclude.

`Brand.png` is the brand board and the fallback. Tracing from it means colour-
thresholding the volt lime out of a dark panel with a glow around it, which
works but is measuring a picture of the logo rather than the logo.

WHAT IT PRODUCES
----------------
Two closed polygons, filled. Nothing else — no stroke, no arcs.

An earlier version traced an ERODED mask and told the consumer to stroke it with
a round join, on the theory that this rounds every corner from a small set of
sharp vertices. That is the right trick for a shape whose corners are sharp in
the source. This one's are not: the official artwork already has its rounding,
so eroding and re-stroking rounded it twice and spent two dozen vertices
retracing curves that were already there.

Tracing the outline as it is reproduces the artwork exactly, including corners
that differ from each other. It costs about thirty vertices per form and a
simplification error of roughly 0.05 viewBox units — under a tenth of a pixel at
the sizes the mark is drawn, and under a pixel on a 512px app icon.

The contour walk is Moore neighbour tracing. An attempt before that ordered
boundary pixels by angle around the centroid, which is only valid for a
star-shaped region; this mark is a concave step, so it interleaved the two sides
of the notch and produced a zigzag.
"""

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

OFFICIAL = "Logo SENT.png"
BOARD = "Brand.png"

# Breathing room the brand board's clear-space panel asks for, in viewBox units.
MARGIN = 1.0
VIEWBOX = 32.0

# Simplification tolerance as a FRACTION of the mark's largest dimension, so a
# 4k export does not produce four times the vertices of a 1k one.
EPS_FRACTION = 0.0015


def load_mask() -> np.ndarray:
    """The mark as a filled binary mask, from the cleanest source available."""
    if os.path.exists(OFFICIAL):
        im = Image.open(OFFICIAL).convert("RGBA")
        alpha = np.asarray(im)[..., 3]
        # Transparent background: no threshold to tune, no glow to exclude.
        # Half-opaque is the antialiased edge, so that is the boundary.
        mask = alpha > 127
        print(f"source: {OFFICIAL} (alpha)", file=sys.stderr)
    else:
        a = np.asarray(Image.open(BOARD).convert("RGB")).astype(np.int16)
        h, w = a.shape[:2]
        # The hero panel, top left. Generous — the colour mask does the work.
        crop = a[int(h * 0.03) : int(h * 0.30), int(w * 0.10) : int(w * 0.30)]
        r, g, b = crop[..., 0], crop[..., 1], crop[..., 2]
        # Volt lime is #C6F600: high green, near-zero blue, and a green-blue gap
        # the glow halo does not have.
        mask = (g > 150) & (b < 120) & (g - b > 90)
        mask = ndimage.binary_opening(mask, np.ones((3, 3)))
        print(f"source: {BOARD} (colour)", file=sys.stderr)

    return ndimage.binary_fill_holes(mask)


def moore(m: np.ndarray) -> np.ndarray:
    """Boundary of a filled mask, clockwise, as (x, y) pixel coordinates."""
    pad = np.pad(m, 1)
    ys, xs = np.nonzero(pad)
    start = (int(ys.min()), int(xs[ys == ys.min()].min()))

    # 8-neighbourhood, clockwise from west.
    nbr = [(0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1)]

    contour = [start]
    cur, back = start, 0

    for _ in range(2_000_000):
        for k in range(8):
            i = (back + 1 + k) % 8
            cand = (cur[0] + nbr[i][0], cur[1] + nbr[i][1])
            if pad[cand]:
                back = (i + 4) % 8
                cur = cand
                break
        else:
            break
        if cur == start and len(contour) > 2:
            break
        contour.append(cur)

    return np.array([[c - 1, r - 1] for r, c in contour], dtype=float)


def rdp(pts: np.ndarray, eps: float) -> np.ndarray:
    """Ramer-Douglas-Peucker. Drops the pixel stair-stepping, keeps the corners."""

    def go(p: np.ndarray) -> np.ndarray:
        if len(p) < 3:
            return p
        s, e = p[0], p[-1]
        d = e - s
        norm = float(np.hypot(d[0], d[1]))
        if norm == 0:
            dist = np.hypot(*(p - s).T)
        else:
            dist = np.abs(d[0] * (s[1] - p[:, 1]) - d[1] * (s[0] - p[:, 0])) / norm
        i = int(np.argmax(dist))
        if dist[i] > eps:
            return np.vstack([go(p[: i + 1])[:-1], go(p[i:])])
        return np.vstack([s, e])

    return go(pts)


def main() -> int:
    mask = load_mask()
    lab, n = ndimage.label(mask)
    if n < 2:
        print(f"expected two forms in the mark, found {n}", file=sys.stderr)
        return 1

    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep = [int(i) + 1 for i in np.argsort(sizes)[::-1][:2]]

    ys, xs = np.nonzero(mask)
    extent = max(xs.max() - xs.min(), ys.max() - ys.min())
    eps = max(1.0, extent * EPS_FRACTION)

    polys = []
    for comp in keep:
        p = rdp(moore(lab == comp), eps=eps)
        if np.allclose(p[0], p[-1]):
            p = p[:-1]
        polys.append(p)

    # Upper form first, so the emitted order matches how the mark reads.
    polys.sort(key=lambda p: p[:, 1].min())

    allp = np.vstack(polys)
    lo, hi = allp.min(axis=0), allp.max(axis=0)
    span = float((hi - lo).max())

    scale = (VIEWBOX - 2 * MARGIN) / span
    offset = (VIEWBOX - (hi - lo) * scale) / 2.0

    out = [(p - lo) * scale + offset for p in polys]

    print(
        f"// {extent}px extent, eps {eps:.1f}px, "
        f"{len(out[0])}/{len(out[1])} vertices, "
        f"~{eps * scale:.3f} viewBox units of error",
        file=sys.stderr,
    )
    for name, p in zip(("UPPER", "LOWER"), out):
        d = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in p) + " Z"
        print(f'const {name} =\n  "{d}";')

    print("\n// JSON, for any other consumer:")
    print(
        json.dumps(
            {"paths": [[[round(float(x), 2), round(float(y), 2)] for x, y in p] for p in out]}
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

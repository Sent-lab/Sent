#!/usr/bin/env python3
"""
Derive the SENT mark's geometry from `Brand.png`.

WHY THIS EXISTS
---------------
The mark in `apps/web/src/components/Logo.tsx` was drawn by eye from the brand
board and did not match it — three flat slabs where the real mark is two stepped
diagonal forms. The board was in the repository the whole time, so the shape can
be measured instead of remembered, and this is the measurement.

Run it when `Brand.png` changes. It prints the two paths and the corner radius
in the same form `Logo.tsx` holds them.

    pip install pillow numpy scipy
    python scripts/trace-mark.py

WHAT IT PRODUCES, AND WHY IT IS SHAPED THAT WAY
-----------------------------------------------
Every corner on the mark is rounded by one radius. Emitting that as arc segments
would be a dozen hand-tuned curves per path that nobody could safely edit later.

So the polygons printed here are the outline INSET by that radius: the consumer
strokes them with twice the radius and a round line join, which grows the shape
back to true size with every corner rounded exactly. That is why the trace runs
against an ERODED mask rather than the raw one.

The contour walk is Moore neighbour tracing. An earlier attempt ordered boundary
pixels by angle around the centroid, which is only valid for a star-shaped
region; this mark is a concave step, so that interleaved the two sides of the
notch and produced a zigzag.
"""

import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

BOARD = "Brand.png"

# Corner radius in source pixels, and the breathing room the board's clear-space
# panel asks for, in viewBox units.
RADIUS_PX = 6
MARGIN = 1.0
VIEWBOX = 32.0


def load_mask() -> np.ndarray:
    """Volt-lime pixels of the hero mark, as a filled binary mask."""
    a = np.asarray(Image.open(BOARD).convert("RGB")).astype(np.int16)
    h, w = a.shape[:2]

    # The hero panel, top left. Generous — the colour mask does the precision.
    crop = a[int(h * 0.03) : int(h * 0.30), int(w * 0.10) : int(w * 0.30)]

    r, g, b = crop[..., 0], crop[..., 1], crop[..., 2]
    # Volt lime is #C6F600: high green, near-zero blue, and a wide green-blue gap
    # that the glow halo around the mark does not have.
    mask = (g > 150) & (b < 120) & (g - b > 90)

    mask = ndimage.binary_opening(mask, np.ones((3, 3)))
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

    for _ in range(200_000):
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
        print(f"expected two components in the mark, found {n}", file=sys.stderr)
        return 1

    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep = [int(i) + 1 for i in np.argsort(sizes)[::-1][:2]]

    polys = []
    for comp in keep:
        inset = ndimage.binary_erosion(lab == comp, np.ones((RADIUS_PX * 2 + 1,) * 2))
        p = rdp(moore(inset), eps=2.2)
        if np.allclose(p[0], p[-1]):
            p = p[:-1]
        polys.append(p)

    # Upper form first, so the emitted order matches how the mark reads.
    polys.sort(key=lambda p: p[:, 1].min())

    # The DRAWN extent is the polygon grown by the stroke radius, so the fit has
    # to account for it or the stroke overflows the viewBox.
    allp = np.vstack(polys)
    lo = allp.min(axis=0) - RADIUS_PX
    hi = allp.max(axis=0) + RADIUS_PX
    span = float((hi - lo).max())

    scale = (VIEWBOX - 2 * MARGIN) / span
    offset = (VIEWBOX - (hi - lo) * scale) / 2.0

    out = [(p - lo) * scale + offset for p in polys]
    radius = RADIUS_PX * scale

    print(f"const CORNER = {radius:.3f};\n")
    for name, p in zip(("UPPER", "LOWER"), out):
        d = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in p) + " Z"
        print(f'const {name} = "{d}";')

    print("\n// JSON, for any other consumer:")
    print(
        json.dumps(
            {
                "radius": round(radius, 3),
                "paths": [[[round(float(x), 2), round(float(y), 2)] for x, y in p] for p in out],
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Generate Flyby's extension icons.

Draws a little paper airplane towing a banner on a sky-blue rounded tile and
writes icon16/32/48/128.png into ../icons. Everything is rendered on a
super-sampled canvas and downscaled with LANCZOS so the small sizes stay crisp.

Run:  python3 tools/make_icons.py
"""

import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(HERE, "..", "icons")

# Sky gradient (top -> bottom) and the plane / banner colors.
SKY_TOP = (74, 163, 255)      # #4aa3ff
SKY_BOTTOM = (30, 111, 224)   # #1e6fe0
PLANE = (255, 255, 255)
PLANE_FOLD = (208, 226, 250)  # subtle shade for the origami fold
BANNER = (255, 214, 92)       # warm banner behind the plane
BANNER_EDGE = (240, 180, 40)


def rotate(point, angle_deg, cx, cy):
    a = math.radians(angle_deg)
    x, y = point[0] - cx, point[1] - cy
    rx = x * math.cos(a) - y * math.sin(a)
    ry = x * math.sin(a) + y * math.cos(a)
    return (rx + cx, ry + cy)


def vertical_gradient(size, top, bottom):
    grad = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        grad.putpixel(
            (0, y),
            (
                round(top[0] + (bottom[0] - top[0]) * t),
                round(top[1] + (bottom[1] - top[1]) * t),
                round(top[2] + (bottom[2] - top[2]) * t),
            ),
        )
    return grad.resize((size, size))


def build(size):
    ss = 8  # super-sampling factor
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Rounded sky tile.
    tile = vertical_gradient(S, SKY_TOP, SKY_BOTTOM).convert("RGBA")
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255
    )
    img.paste(tile, (0, 0), mask)

    draw = ImageDraw.Draw(img)
    cx, cy = S / 2, S / 2
    ang = -22  # tilt the whole scene so the plane climbs to the upper-right

    # --- Banner trailing behind the plane (a little wavy pennant) ---
    bx = S * 0.18   # banner left edge
    bw = S * 0.34   # banner width
    by = S * 0.52   # banner vertical center
    bh = S * 0.13   # banner height
    wob = S * 0.03
    banner = [
        (bx, by - bh / 2),
        (bx + bw * 0.5, by - bh / 2 - wob),
        (bx + bw, by - bh / 2),
        (bx + bw, by + bh / 2),
        (bx + bw * 0.5, by + bh / 2 + wob),
        (bx, by + bh / 2),
    ]
    banner = [rotate(p, ang, cx, cy) for p in banner]
    draw.polygon(banner, fill=BANNER, outline=BANNER_EDGE, width=max(1, ss))

    # Tow line from banner to the plane tail.
    line_a = rotate((bx + bw, by), ang, cx, cy)
    line_b = rotate((S * 0.60, S * 0.44), ang, cx, cy)
    draw.line([line_a, line_b], fill=PLANE, width=max(2, ss))

    # --- Paper airplane (nose to the right) ---
    nose = (S * 0.86, S * 0.44)
    top_back = (S * 0.52, S * 0.24)
    notch = (S * 0.63, S * 0.44)
    bot_back = (S * 0.52, S * 0.60)

    upper = [rotate(p, ang, cx, cy) for p in (nose, top_back, notch)]
    lower = [rotate(p, ang, cx, cy) for p in (nose, notch, bot_back)]
    draw.polygon(lower, fill=PLANE_FOLD)
    draw.polygon(upper, fill=PLANE)
    # Center fold line.
    draw.line(
        [rotate(nose, ang, cx, cy), rotate(notch, ang, cx, cy)],
        fill=BANNER_EDGE,
        width=max(1, ss // 2),
    )

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        out = os.path.join(ICON_DIR, f"icon{size}.png")
        build(size).save(out)
        print("wrote", os.path.relpath(out, os.path.join(HERE, "..")))


if __name__ == "__main__":
    main()

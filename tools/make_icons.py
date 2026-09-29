#!/usr/bin/env python3
"""Generate Flyby's extension icons.

Draws a flat, top-down twin-jet (white fuselage, red tail fin, pale swept wings,
grey engines, dark nose) on a sky-blue rounded tile, and writes
icon16/32/48/128.png into ../icons. Everything is rendered on a super-sampled
canvas and downscaled with LANCZOS so the small sizes stay crisp.

Run:  python3 tools/make_icons.py
"""

import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(HERE, "..", "icons")

SKY_TOP = (74, 163, 255)      # #4aa3ff
SKY_BOTTOM = (30, 111, 224)   # #1e6fe0

WING_U = (228, 237, 251)
WING_L = (206, 221, 245)
TAILPLANE_U = (233, 240, 251)
TAILPLANE_L = (213, 225, 243)
FIN_RED = (232, 67, 77)
BODY = (255, 255, 255)
BELLY = (225, 232, 243)
NOSE = (38, 50, 74)
ENGINE_U = (223, 231, 244)
ENGINE_L = (203, 214, 232)
WINDOW = (43, 54, 72)

# Artwork authored in a 64-unit space, plane pointing right.
ART_X0, ART_X1 = 5.5, 56.0
ART_Y0, ART_Y1 = 9.0, 55.0

WING_UPPER = [(37, 29), (19, 9), (12.5, 11.5), (28.5, 29)]
WING_LOWER = [(37, 35), (19, 55), (12.5, 52.5), (28.5, 35)]
TAIL_UPPER = [(13, 30), (5.5, 24), (9.8, 22.6), (16.2, 29.4)]
TAIL_LOWER = [(13, 34), (5.5, 40), (9.8, 41.4), (16.2, 34.6)]
FIN = [(16, 29.5), (7.5, 15), (12.6, 14), (21.5, 29)]
NOSE_TIP = [(48.5, 28.3), (56, 32), (48.5, 35.7)]


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
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    img.paste(tile, (0, 0), mask)

    draw = ImageDraw.Draw(img)

    # Fit the artwork into ~76% of the tile, centred.
    art_w, art_h = ART_X1 - ART_X0, ART_Y1 - ART_Y0
    scale = (0.76 * S) / art_w
    off_x = (S - art_w * scale) / 2 - ART_X0 * scale
    off_y = (S - art_h * scale) / 2 - ART_Y0 * scale

    def P(pts):
        return [(x * scale + off_x, y * scale + off_y) for x, y in pts]

    def box(x0, y0, x1, y1):
        return [x0 * scale + off_x, y0 * scale + off_y, x1 * scale + off_x, y1 * scale + off_y]

    draw.polygon(P(WING_UPPER), fill=WING_U)
    draw.polygon(P(WING_LOWER), fill=WING_L)
    draw.polygon(P(TAIL_UPPER), fill=TAILPLANE_U)
    draw.polygon(P(TAIL_LOWER), fill=TAILPLANE_L)
    draw.polygon(P(FIN), fill=FIN_RED)

    # Fuselage capsule + belly shade + dark nose.
    draw.rounded_rectangle(box(9.4, 27.2, 56, 36.8), radius=4.8 * scale, fill=BODY)
    draw.line(
        [(13.5 * scale + off_x, 35.4 * scale + off_y), (47 * scale + off_x, 35.4 * scale + off_y)],
        fill=BELLY,
        width=max(1, int(2.2 * scale)),
    )
    draw.polygon(P(NOSE_TIP), fill=NOSE)

    # Engines.
    draw.rounded_rectangle(box(25, 13.4, 38.5, 20.4), radius=3.5 * scale, fill=ENGINE_U)
    draw.rounded_rectangle(box(25, 43.6, 38.5, 50.6), radius=3.5 * scale, fill=ENGINE_L)

    # Windows (skipped at the smallest size, where they'd turn to mush).
    if size >= 32:
        r = 1.25 * scale
        for wx in (24, 28, 32, 36, 40, 44):
            cx, cy = wx * scale + off_x, 32 * scale + off_y
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WINDOW)

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        out = os.path.join(ICON_DIR, f"icon{size}.png")
        build(size).save(out)
        print("wrote", os.path.relpath(out, os.path.join(HERE, "..")))


if __name__ == "__main__":
    main()

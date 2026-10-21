# -*- coding: utf-8 -*-
"""Generate Windows toast hero images (2:1, 728x360 = 364x180 @200%).

Output: assets/toast-hero-focus.png  (tomato red  - 专注结束)
        assets/toast-hero-break.png  (sage green  - 休息结束)

Hero images are decorative: brand gradient + big tomato mark + rhythm dots.
Keep the mark inside the safe area (Windows may letterbox/crop edge pixels).
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")
W, H = 728, 360          # 2:1, 100% = 364x180
S = 2                    # supersample factor for smooth edges

FOCUS = dict(bg=(38, 31, 28), glow=(229, 83, 75), ring=(255, 138, 128))
BREAK = dict(bg=(28, 36, 32), glow=(46, 154, 113), ring=(139, 219, 184))


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def radial(size, center, radius, color, alpha, falloff=2.0):
    """Soft round glow as an RGBA layer."""
    w, h = size
    layers = []
    steps = 70
    for i in range(steps):
        t = i / (steps - 1)
        r = radius * (1 - t) ** (1 / falloff)
        a = int(alpha * t ** falloff)
        if a <= 0 or r <= 0:
            continue
        layers.append((r, a))
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r, a in sorted(layers, reverse=True):
        gd.ellipse([center[0] - r, center[1] - r * 0.95,
                    center[0] + r, center[1] + r * 0.95],
                   fill=color + (a,))
    return glow.filter(ImageFilter.GaussianBlur(w * 0.02))


def build(theme, rings_side="right", dots=0, dots_active=0):
    w, h = W * S, H * S
    base = theme["bg"]
    img = Image.new("RGBA", (w, h), base + (255,))

    # --- background: diagonal brand gradient (left dark -> right tinted) ---
    grad = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    deep = lerp(base, theme["glow"], 0.62)
    for x in range(0, w, 2):
        t = x / (w - 1)
        col = lerp(base, deep, t ** 2.6)
        gd.rectangle([x, 0, x + 2, h], fill=col + (255,))
    img = Image.alpha_composite(img, grad)

    # --- soft brand glow behind the mark ---
    img = Image.alpha_composite(
        img, radial((w, h), (int(w * 0.30), int(h * 0.50)), int(w * 0.30),
                    theme["glow"], 85, falloff=2.6)
    )

    # --- concentric rings on the right (visual rhythm, low contrast) ---
    rings = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rings)
    cx = int(w * (0.86 if rings_side == "right" else 0.14))
    cy = int(h * 0.5)
    for i, r in enumerate([int(w * 0.16), int(w * 0.24), int(w * 0.32)]):
        rd.ellipse([cx - r, cy - r, cx + r, cy + r],
                   outline=theme["ring"] + (max(10, 46 - i * 12),),
                   width=int(2 * S))
    img = Image.alpha_composite(img, rings)

    # --- pomodoro rhythm bar along the bottom (strength = filled segments) ---
    if dots:
        gap = 10 * S
        bw = 26 * S
        bh = 6 * S
        total = dots * bw + (dots - 1) * gap
        x0 = int(w * 0.30) - total // 2          # centered under the mark
        y0 = h - 40 * S
        bd = ImageDraw.Draw(img)
        for i in range(dots):
            x = x0 + i * (bw + gap)
            col = theme["glow"] + (255,) if i < dots_active else (255, 255, 255, 46)
            bd.rounded_rectangle([x, y0, x + bw, y0 + bh],
                                 radius=bh // 2, fill=col)

    # --- the tomato mark ---
    icon = Image.open(os.path.join(ROOT, "icon@2x.png")).convert("RGBA")
    isz = int(h * 0.58)
    icon = icon.resize((isz, isz), Image.LANCZOS)
    ix = int(w * 0.30 - isz / 2)
    iy = int(h * 0.52 - isz / 2)
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    pad = int(isz * 0.02)
    sd.ellipse([ix + pad, iy + isz * 0.72, ix + isz - pad, iy + isz * 1.06],
               fill=(0, 0, 0, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(isz * 0.16))
    img = Image.alpha_composite(img, shadow)

    mark = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    mark.paste(icon, (ix, iy), icon)
    img = Image.alpha_composite(img, mark)

    # --- vignette so edges never look clipped ---
    vig = Image.new("L", (w, h), 0)
    vd = ImageDraw.Draw(vig)
    vd.ellipse([-w * 0.35, -h * 0.9, w * 1.35, h * 1.9], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(w * 0.10))
    dark = Image.new("RGBA", (w, h), (0, 0, 0, 70))
    img = Image.composite(img, Image.alpha_composite(img, dark), vig)

    return img.convert("RGB").resize((W, H), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
build(FOCUS, dots=4, dots_active=4).save(os.path.join(OUT, "toast-hero-focus.png"))
build(BREAK, dots=4, dots_active=1).save(os.path.join(OUT, "toast-hero-break.png"))
print("written: assets/toast-hero-focus.png  assets/toast-hero-break.png  (%dx%d)" % (W, H))

# -*- coding: utf-8 -*-
"""Generate TomatoFocus app icon (tomato) as PNG + ICO in project root."""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE = 1024  # draw big, downscale for anti-aliasing

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

cx, cy = SIZE / 2, SIZE * 0.56
rx, ry = SIZE * 0.36, SIZE * 0.33  # slightly squashed tomato body

# ---------- body: radial gradient ----------
body = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
bd = ImageDraw.Draw(body)
bd.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(210, 40, 40, 255))
body = body.filter(ImageFilter.GaussianBlur(1))

# gradient layer: light source top-left
grad = Image.new("L", (SIZE, SIZE), 0)
gd = ImageDraw.Draw(grad)
hl_x, hl_y = cx - rx * 0.35, cy - ry * 0.45
steps = 90
for i in range(steps):
    t = i / (steps - 1)
    r = rx * (1.25 - t * 1.05)
    alpha = int(90 * (1 - t))
    gd.ellipse([hl_x - r, hl_y - r * 0.9, hl_x + r, hl_y + r * 0.9], fill=alpha)
light = Image.new("RGBA", (SIZE, SIZE), (255, 120, 110, 255))
# clip gradient to the tomato body so no halo leaks outside
from PIL import ImageChops
body_alpha = body.split()[3]
grad = ImageChops.multiply(grad, body_alpha)
body = Image.composite(light, body, grad)

# ---------- leaves (calyx): 5 pointed leaves + stem ----------
def leaf(draw, ox, oy, angle, length, width, color):
    a = math.radians(angle)
    tip = (ox + math.cos(a) * length, oy + math.sin(a) * length)
    left = (ox + math.cos(a + math.pi / 2) * width, oy + math.sin(a + math.pi / 2) * width)
    right = (ox + math.cos(a - math.pi / 2) * width, oy + math.sin(a - math.pi / 2) * width)
    base = (ox, oy)
    draw.polygon([base, left, tip, right], fill=color)

top_y = cy - ry * 0.92
leaves = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ld = ImageDraw.Draw(leaves)
green_dark = (34, 120, 50, 255)
green = (58, 160, 70, 255)
for ang in (-160, -125, -90, -55, -20):
    leaf(ld, cx, top_y + SIZE * 0.02, ang, SIZE * 0.17, SIZE * 0.045, green)
# stem
ld.rounded_rectangle([cx - SIZE * 0.018, top_y - SIZE * 0.10,
                      cx + SIZE * 0.018, top_y + SIZE * 0.02],
                     radius=SIZE * 0.015, fill=green_dark)
# subtle darker rim under leaves for depth
shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.ellipse([cx - rx * 0.98, cy - ry * 0.75, cx + rx * 0.98, cy + ry * 0.80], fill=(120, 10, 15, 70))
shadow = shadow.filter(ImageFilter.GaussianBlur(SIZE * 0.02))

img = Image.alpha_composite(img, body)
img = Image.alpha_composite(img, shadow)
img = Image.alpha_composite(img, leaves)

# ---------- glossy highlight ----------
gloss = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gd2 = ImageDraw.Draw(gloss)
gd2.ellipse([cx - rx * 0.55, cy - ry * 0.75, cx - rx * 0.05, cy - ry * 0.25], fill=(255, 255, 255, 70))
gloss = gloss.filter(ImageFilter.GaussianBlur(SIZE * 0.015))
img = Image.alpha_composite(img, gloss)

# ---------- export ----------
icon_512 = img.resize((512, 512), Image.LANCZOS)
icon_256 = img.resize((256, 256), Image.LANCZOS)
icon_256.save(os.path.join(ROOT, "icon.png"))
icon_512.save(os.path.join(ROOT, "icon@2x.png"))

# ICO with several sizes (PNG-compressed frames)
img.resize((256, 256), Image.LANCZOS).save(
    os.path.join(ROOT, "icon.ico"),
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("written: icon.png / icon@2x.png / icon.ico")

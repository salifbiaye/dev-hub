from PIL import Image, ImageDraw

SIZE = 512
ACCENT = (110, 86, 207, 255)
WHITE = (255, 255, 255, 255)


def rounded_square(size, radius, color):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=color)
    return img, draw


def diamond(draw, cx, cy, half_w, half_h, color):
    draw.polygon(
        [(cx, cy - half_h), (cx + half_w, cy), (cx, cy + half_h), (cx - half_w, cy)],
        fill=color,
    )


def chevron(draw, cx, cy, half_w, half_h, thickness, color):
    draw.line([(cx - half_w, cy - half_h), (cx, cy), (cx + half_w, cy - half_h)], fill=color, width=thickness, joint="curve")


img, draw = rounded_square(SIZE, radius=110, color=ACCENT)

# Matches IconLayers (frontend/src/icons.jsx): a diamond and a single
# chevron below it, not two.
cx = SIZE / 2
diamond(draw, cx, SIZE * 0.40, half_w=SIZE * 0.26, half_h=SIZE * 0.15, color=WHITE)
chevron(draw, cx, SIZE * 0.66, half_w=SIZE * 0.24, half_h=SIZE * 0.10, thickness=int(SIZE * 0.05), color=WHITE)

img.save("icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
img.save("icon.png")
print("icon written")

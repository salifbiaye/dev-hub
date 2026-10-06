"""Themed taskbar icon generation -- Pillow drawing is cross-platform; only
*applying* the generated .ico to a window differs by OS (core/platform)."""
import time

import webview

from app_config import APP_DATA_DIR

# Mirrors --color-accent for every theme in frontend/src/index.css, so the
# taskbar icon can be recolored to match instead of staying a fixed purple
# regardless of which theme is actually active.
THEME_ACCENTS = {
    "dark": "#6e56cf",
    "light": "#6e56cf",
    "tokyo-night": "#7aa2f7",
    "monokai": "#66d9ef",
    "catppuccin-mocha": "#cba6f7",
    "dracula": "#bd93f9",
    "nord": "#88c0d0",
    "gruvbox-dark": "#fe8019",
    "tokyo-day": "#2e7de9",
    "catppuccin-latte": "#8839ef",
    "atom-one-dark": "#61afef",
    "atom-one-light": "#4078f2",
    "halloween": "#ff7518",
    "diwali": "#f2b705",
    "movember": "#c17d3a",
    "dia-de-muertos": "#ff5f9e",
    "winter-day": "#3a7bd5",
    "solarized-dark": "#268bd2",
    "rose-pine": "#c4a7e7",
    "ayu-dark": "#ffb454",
    "synthwave": "#ff2e97",
    "night-owl": "#7fdbca",
    "palenight": "#f78c6c",
    "horizon": "#e95678",
    "everforest": "#a7c080",
    "indigo-black": "#6366f1",
    "crimson-black": "#ff3355",
    "emerald-black": "#10b981",
    "amber-black": "#f5a623",
    "github-dark": "#58a6ff",
    "github-light": "#0969da",
    "webstorm": "#3574f0",
}

ICON_DESIGN_VERSION = "v2"


def theme_icon_path(hex_color):
    # Cached per color under APP_DATA_DIR — regenerating a handful of small
    # PNGs/ICOs on first use per theme is cheap, but there's no reason to
    # redo it on every switch back to an already-seen theme. The version
    # tag means a design change (e.g. v1 -> v2 dropped an extra chevron
    # that didn't match the in-app logo) invalidates old cached files
    # instead of silently keeping the outdated art forever.
    icons_dir = APP_DATA_DIR / "icons"
    icons_dir.mkdir(exist_ok=True)
    ico_path = icons_dir / f"{hex_color.lstrip('#')}-{ICON_DESIGN_VERSION}.ico"
    if ico_path.exists():
        return ico_path

    from PIL import Image, ImageDraw

    size = 256
    accent = tuple(int(hex_color.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4)) + (255,)
    white = (255, 255, 255, 255)

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 4.6, fill=accent)

    # Matches IconLayers (frontend/src/icons.jsx) exactly: a diamond and a
    # single chevron below it — the generated icon used to add a second
    # chevron the in-app logo doesn't have.
    cx = size / 2
    cy = size * 0.40
    hw, hh = size * 0.26, size * 0.15
    draw.polygon([(cx, cy - hh), (cx + hw, cy), (cx, cy + hh), (cx - hw, cy)], fill=white)

    thickness = int(size * 0.05)
    cy = size * 0.66
    hw, hh = size * 0.24, size * 0.10
    draw.line([(cx - hw, cy - hh), (cx, cy), (cx + hw, cy - hh)], fill=white, width=thickness, joint="curve")

    img.save(ico_path, sizes=[(256, 256), (64, 64), (32, 32), (16, 16)])
    return ico_path


def apply_window_icon(theme, retries=1):
    # Called right at startup, the native form may not exist yet
    # (create_window only registers the config — the real OS window that
    # actually builds it starts inside webview.start()), so a few retries
    # cover that race. The actual OS-level "set this icon on that window"
    # call lives behind core/platform (differs by OS); only the drawing
    # above is shared.
    from core.platform import platform_svc

    win = webview.windows[0]
    ico_path = theme_icon_path(THEME_ACCENTS.get(theme, THEME_ACCENTS["dark"]))
    ok = platform_svc.apply_window_icon(win, ico_path)
    if not ok and retries > 0:
        time.sleep(0.5)
        apply_window_icon(theme, retries - 1)

"""System-tray icon for Hubi: two little eyes that follow the current mood,
plus the menu (show/hide, size, test a mood, reset position, quit).

pystray is optional: without it (or without a tray on this desktop) Hubi
still works, it just has no menu.
"""
from . import window

_icon = None

# mood -> (shape, color). Shapes: open, half, arc, cross, small, slant, iris.
_CYAN = (0, 229, 255)
_AMBER = (255, 193, 7)
_RED = (255, 82, 82)
_GREEN = (105, 240, 174)
_MOOD_ICON = {
    "normal": ("open", _CYAN),
    "sleepy": ("half", _CYAN),
    "asleep": ("half", _CYAN),
    "startle": ("big", _CYAN),
    "excited": ("big", _CYAN),
    "laugh": ("arc", _CYAN),
    "focused": ("slant", _CYAN),
    "acting": ("iris", _CYAN),
    "fear": ("small", _CYAN),
    "error": ("cross", _RED),
    "listening": ("open", _CYAN),
    "understood": ("open", _CYAN),
    "alert": ("big", _AMBER),
    "happy": ("arc", _GREEN),
}


def _make_image(mood):
    from PIL import Image, ImageDraw

    S = 256  # drawn large, then downscaled for smooth edges
    shape, color = _MOOD_ICON.get(mood, _MOOD_ICON["normal"])
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((8, 8, S - 8, S - 8), radius=56, fill=(0, 0, 0, 255))
    fill = color + (255,)
    centers = (S * 0.33, S * 0.67)
    cy = S * 0.5

    for cx in centers:
        if shape in ("open", "big", "small", "half", "slant", "iris"):
            w, h = {"open": (50, 74), "big": (58, 92), "small": (28, 38), "half": (50, 74), "slant": (50, 66), "iris": (56, 74)}[shape]
            box = (cx - w, cy - h, cx + w, cy + h)
            d.rounded_rectangle(box, radius=w * 0.7, fill=fill)
            if shape == "half":
                d.rectangle((cx - w - 2, cy - h - 2, cx + w + 2, cy), fill=(0, 0, 0, 255))
            elif shape == "slant":
                inner = -1 if cx < S / 2 else 1  # inner side is lower
                d.polygon(
                    [
                        (cx - w - 2, cy - h - 2),
                        (cx + w + 2, cy - h - 2),
                        (cx + w + 2, cy - h + (46 if inner == -1 else 4)),
                        (cx - w - 2, cy - h + (4 if inner == -1 else 46)),
                    ],
                    fill=(0, 0, 0, 255),
                )
            elif shape == "iris":
                d.ellipse((cx - 38, cy - 38, cx + 38, cy + 38), fill=(4, 18, 26, 255), outline=fill, width=7)
                d.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=(255, 255, 255, 255))
        elif shape == "arc":
            d.arc((cx - 50, cy - 20, cx + 50, cy + 80), 200, 340, fill=fill, width=26)
        elif shape == "cross":
            r = 46
            d.line((cx - r, cy - r, cx + r, cy + r), fill=fill, width=24)
            d.line((cx - r, cy + r, cx + r, cy - r), fill=fill, width=24)

    return img.resize((64, 64), Image.LANCZOS)


def _build_menu(on_quit):
    import pystray

    item, menu = pystray.MenuItem, pystray.Menu

    def sizes():
        return [
            item(
                key,
                (lambda k: lambda icon, it: _set_size(k))(key),
                checked=(lambda k: lambda it: window.current_size() == k)(key),
                radio=True,
            )
            for key in window.SIZES
        ]

    def mascots():
        return [
            item(
                label,
                (lambda n: lambda icon, it: window.set_mascot(n))(name),
                checked=(lambda n: lambda it: window.current_mascot() == n)(name),
                radio=True,
            )
            for name, label in window.MASCOTS
        ]

    def moods():
        return [
            item(label, (lambda n: lambda icon, it: window.send_mood(n, None if n != "normal" else 0))(name))
            for name, label in window.MOODS
        ]

    return menu(
        item(
            "Afficher / masquer les yeux",
            lambda icon, it: window.toggle_visible(),
            default=True,
        ),
        item("Taille", menu(*sizes())),
        item("Mascotte", menu(*mascots())),
        item("Tester une humeur", menu(*moods())),
        item(
            "Yeux aux couleurs du thème",
            lambda icon, it: window.set_follow_theme(not window.follows_theme()),
            checked=lambda it: window.follows_theme(),
        ),
        item("Replacer en haut à droite", lambda icon, it: window.reset_position()),
        menu.SEPARATOR,
        item("Quitter", lambda icon, it: on_quit()),
    )


def _set_size(key):
    window.set_size(key)
    if _icon is not None:
        _icon.update_menu()


def _on_mood(mood):
    if _icon is not None:
        try:
            _icon.icon = _make_image(mood)
        except Exception:
            pass


def start(on_quit):
    """Show the tray icon (non-blocking). Returns True if it is running."""
    global _icon
    if _icon is not None:
        return True
    try:
        import pystray

        _icon = pystray.Icon("hubi", _make_image(window.current_mood()), "Hubi", _build_menu(on_quit))
        window.on_mood_change(_on_mood)
        _icon.run_detached()
        return True
    except Exception as e:
        _icon = None
        print(f"[hubi] pas d'icône de zone de notification : {e}")
        return False


def stop():
    global _icon
    icon, _icon = _icon, None
    if icon is not None:
        try:
            icon.stop()
        except Exception:
            pass

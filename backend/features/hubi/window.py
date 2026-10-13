"""Hubi's floating eyes window: creation, geometry, drag, and the small
pull-based bridge the page polls (cursor, idle time, queued commands).

The page pulls everything it needs through HubiApi.poll() instead of Python
pushing with evaluate_js, which keeps all cross-thread traffic one-directional
and robust (no calls into a page that is still loading or being destroyed).
"""
import math
import threading
import time
from collections import deque

import webview

from app_config import load_config, save_config
from core.platform import platform_svc

SIZES = {"S": (180, 108), "M": (250, 150), "L": (340, 204), "XL": (450, 270)}
DEFAULT_SIZE = "S"
MASCOTS = [
    ("light", "Hubi clair"),
    ("graphite", "Hubi graphite"),
    ("auto", "Hubi auto (gris quand il dort)"),
]
DEFAULT_MASCOT = "light"
MARGIN = 16  # logical px from the top-right corner of the primary screen
TOPMOST_EVERY = 2.0  # s between z-order refreshes (full-screen apps bury it)

MOODS = [
    ("normal", "Normal"),
    ("sleepy", "Somnolent"),
    ("asleep", "Endormi"),
    ("startle", "Sursaut"),
    ("excited", "Excité"),
    ("laugh", "Rire"),
    ("focused", "Concentré"),
    ("acting", "Iris-circuit (Claude agit)"),
    ("fear", "Peur"),
    ("error", "Erreur"),
    ("listening", "Écoute"),
    ("understood", "Compris"),
    ("alert", "Alerte"),
    ("happy", "Content"),
]
MOOD_NAMES = [name for name, _ in MOODS]

_window = None
_base_url = None
_lock = threading.Lock()
_cmds = deque()
_mood = "normal"
_mood_listeners = []
_last_topmost = 0.0

# The page polls ~30x/s. If it goes silent, its renderer died (the window then
# stays up but black): reload the page.
WATCHDOG_SILENCE = 8.0
_last_poll = {"at": None}
# The page can keep polling while drawing nothing (Chromium decided the window
# was hidden, or its GPU side failed): the window then shows black. The page
# reports how many frames it drew; frames stuck while visible = reload.
FRAME_STALL = 6.0
_frames = {"count": None, "at": None}
_applied = {"size": None}

# poll() runs ~30x/s; the theme name comes from config.json, so it is re-read
# at most once per THEME_REFRESH seconds.
THEME_REFRESH = 1.5
_theme_cache = {"at": 0.0, "value": None}

# Drag state (native path: a Python thread follows the cursor).
_drag_thread = None
_drag_moved = 0.0  # physical px, largest distance from the drag origin
_fallback_moved = 0.0


# ---------------------------------------------------------------- config

def _cfg():
    cfg = load_config().get("hubi") or {}
    size = cfg.get("size")
    return {
        "enabled": bool(cfg.get("enabled", False)),
        "size": size if size in SIZES else DEFAULT_SIZE,
        "visible": bool(cfg.get("visible", True)),
        "follow_theme": bool(cfg.get("follow_theme", True)),
        "sound": bool(cfg.get("sound", True)),
        "all_desktops": bool(cfg.get("all_desktops", True)),
        "mascot": cfg.get("mascot") if cfg.get("mascot") in dict(MASCOTS) else DEFAULT_MASCOT,
        "x": cfg.get("x"),
        "y": cfg.get("y"),
    }


def _save(**changes):
    config = load_config()
    hubi = config.get("hubi") or {}
    hubi.update(changes)
    config["hubi"] = hubi
    save_config(config)


def is_enabled():
    return _cfg()["enabled"]


def set_enabled_flag(value):
    _save(enabled=bool(value))


def current_size():
    return _cfg()["size"]


def current_mood():
    return _mood


def is_visible():
    return _window is not None and _cfg()["visible"]


def is_created():
    return _window is not None


def current_mascot():
    return _cfg()["mascot"]


def set_mascot(name):
    if name in dict(MASCOTS):
        _save(mascot=name)


def follows_theme():
    return _cfg()["follow_theme"]


def set_follow_theme(value):
    _save(follow_theme=bool(value))
    _theme_cache["at"] = 0.0  # let the next poll pick it up immediately


def all_desktops():
    return _cfg()["all_desktops"]


def sound_enabled():
    return _cfg()["sound"]


def set_sound(value):
    _save(sound=bool(value))


_reload_listeners = []


def on_page_reload(callback):
    _reload_listeners.append(callback)


def on_mood_change(callback):
    _mood_listeners.append(callback)


# ---------------------------------------------------------------- geometry

def _scale():
    return platform_svc.overlay_dpi_scale(_window) if _window is not None else 1.0


def _physical_size(size_key):
    w, h = SIZES[size_key]
    s = _scale()
    return int(round(w * s)), int(round(h * s))


def _default_position(pw, ph):
    primary_w, _ = platform_svc.overlay_screen()["primary"]
    margin = int(round(MARGIN * _scale()))
    return primary_w - pw - margin, margin


def _on_screen(x, y, pw, ph):
    vx, vy, vw, vh = platform_svc.overlay_screen()["virtual"]
    # At least a 40 px grip of the widget must remain reachable.
    return vx - pw + 40 <= x <= vx + vw - 40 and vy <= y <= vy + vh - 40


def _apply_geometry():
    cfg = _cfg()
    pw, ph = _physical_size(cfg["size"])
    x, y = cfg["x"], cfg["y"]
    if not (isinstance(x, int) and isinstance(y, int) and _on_screen(x, y, pw, ph)):
        x, y = _default_position(pw, ph)
    platform_svc.overlay_set_rect(_window, x, y, pw, ph)


def _save_position():
    r = platform_svc.overlay_rect(_window)
    if r:
        _save(x=int(r[0]), y=int(r[1]))


def reset_position():
    if _window is None:
        return
    _save(x=None, y=None)
    pw, ph = _physical_size(_cfg()["size"])
    x, y = _default_position(pw, ph)
    platform_svc.overlay_set_rect(_window, x, y, pw, ph)


def save_size(size_key):
    """From another process (Dev Hub): the Hubi process resizes on its next poll."""
    if size_key in SIZES:
        _save(size=size_key)


def set_size(size_key):
    if _window is None or size_key not in SIZES:
        return
    _save(size=size_key)
    _applied["size"] = size_key
    r = platform_svc.overlay_rect(_window)
    pw, ph = _physical_size(size_key)
    if not r:
        return
    # Keep the right edge fixed: the widget lives against the screen's right side.
    x = r[0] + r[2] - pw
    platform_svc.overlay_set_rect(_window, x, r[1], pw, ph)
    _save_position()


# ---------------------------------------------------------------- lifecycle

def configure(base_url):
    """Remember where hubi.html is served from (set once at startup)."""
    global _base_url
    _base_url = base_url.rstrip("/")


def _on_shown():
    platform_svc.overlay_prepare(_window)
    try:
        from . import process

        platform_svc.apply_window_icon(_window, str(process._hubi_icon_path()))
    except Exception:
        pass
    # Follow the user from one virtual desktop to another (Win+Ctrl+arrows).
    try:
        platform_svc.overlay_follow_desktops(_window, all_desktops)
    except Exception:
        pass
    _apply_geometry()
    if not _cfg()["visible"]:
        platform_svc.overlay_set_visible(_window, False)
    threading.Thread(target=_watchdog, daemon=True).start()


def _watchdog():
    _last_poll["at"] = time.monotonic()
    while _window is not None:
        time.sleep(2.0)
        win = _window
        if win is None:
            return
        # A hidden page has its timers throttled by Chromium: silence is normal.
        if not _cfg()["visible"]:
            _last_poll["at"] = time.monotonic()
            _frames["count"], _frames["at"] = None, None
            continue
        stalled = _frames["at"] is not None and time.monotonic() - _frames["at"] > FRAME_STALL
        if stalled or time.monotonic() - _last_poll["at"] > WATCHDOG_SILENCE:
            _frames["count"], _frames["at"] = None, None
            _last_poll["at"] = time.monotonic()  # give the reload time to come up
            try:
                # A fresh query string: setting WebView2's Source to the URL it
                # already has is a no-op, even after its renderer crashed.
                win.load_url(f"{_base_url}/hubi.html?r={int(time.time())}")
            except Exception:
                pass
            # The fresh page knows nothing: resend badges, bubble and mood.
            for callback in list(_reload_listeners):
                try:
                    callback()
                except Exception:
                    pass


def _on_closed():
    global _window
    _window = None


def create():
    """Create the widget window (call before webview.start(), or later from
    any thread — pywebview supports both). No-op if it already exists."""
    global _window
    if _window is not None or _base_url is None:
        return _window
    w, h = SIZES[_cfg()["size"]]
    _window = webview.create_window(
        "Hubi",
        f"{_base_url}/hubi.html",
        js_api=HubiApi(),
        width=w,
        height=h,
        # Created off-screen; _on_shown() moves it to its real position so
        # there is no flash at pywebview's default centered spot.
        x=-4000,
        y=-4000,
        frameless=True,
        easy_drag=False,
        shadow=False,
        focus=False,
        on_top=True,
        # Not transparent: the face fills the window and Windows rounds it
        # (core/platform/windows/overlay.py). pywebview's transparent mode
        # also calls Activate() when the page loads, stealing the focus.
        resizable=False,
        min_size=(150, 90),
        background_color="#000000",
        text_select=False,
    )
    _window.events.shown += _on_shown
    _window.events.closed += _on_closed
    return _window


def destroy():
    global _window
    win, _window = _window, None
    if win is not None:
        try:
            win.destroy()
        except Exception:
            pass


def set_visible(visible):
    if _window is None:
        return
    _save(visible=bool(visible))
    platform_svc.overlay_set_visible(_window, bool(visible))


def toggle_visible():
    set_visible(not _cfg()["visible"])


def send_mood(name, ms=None):
    """Queue a mood for the page (forced mood from the menu, later: Claude
    session events). `ms` None = the page's own default duration."""
    if name not in MOOD_NAMES:
        return
    push_cmd("mood", name, ms)


def push_cmd(*cmd):
    """Queue a command for the page's next poll (bubble, timer, beep…)."""
    with _lock:
        _cmds.append(list(cmd))


# ---------------------------------------------------------------- bridge for the page

def _report_mood(name):
    global _mood
    if name == _mood:
        return
    _mood = name
    for cb in list(_mood_listeners):
        try:
            cb(name)
        except Exception:
            pass


def _current_theme():
    now = time.monotonic()
    if now - _theme_cache["at"] > THEME_REFRESH:
        config = load_config()
        follow = (config.get("hubi") or {}).get("follow_theme", True)
        _theme_cache["value"] = config.get("theme", "dark") if follow else None
        _theme_cache["at"] = now
    return _theme_cache["value"]


def _drag_loop(start_cursor, start_rect):
    global _drag_moved
    scale = _scale()
    while platform_svc.left_button_down():
        pos = platform_svc.cursor_pos()
        if pos is None:
            break
        dx = pos[0] - start_cursor[0]
        dy = pos[1] - start_cursor[1]
        _drag_moved = max(_drag_moved, math.hypot(dx, dy))
        if _drag_moved > 0:
            platform_svc.overlay_set_rect(_window, start_rect[0] + dx, start_rect[1] + dy)
        time.sleep(0.008)
    _drag_moved = _drag_moved / scale  # report in CSS px
    _save_position()


class HubiApi:
    """The js_api object for the widget page. Public methods only: pywebview
    exposes every public attribute, so no state lives on the instance."""

    def poll(self, frames=None):
        global _last_topmost
        win = _window
        if win is None:
            return None
        now = time.monotonic()
        _last_poll["at"] = now
        if frames is not None and frames != _frames["count"]:
            _frames["count"], _frames["at"] = frames, now
        if now - _last_topmost > TOPMOST_EVERY:
            _last_topmost = now
            platform_svc.overlay_keep_on_top(win)

        cursor = None
        pos = platform_svc.cursor_pos()
        r = platform_svc.overlay_rect(win)
        if pos is not None and r is not None:
            s = platform_svc.overlay_dpi_scale(win)
            cursor = [(pos[0] - (r[0] + r[2] / 2)) / s, (pos[1] - (r[1] + r[3] / 2)) / s]

        with _lock:
            cmds = list(_cmds)
            _cmds.clear()
        cfg = _cfg()
        # Dev Hub's Hubi page only writes config.json: apply a new size here.
        if _applied["size"] is None:
            _applied["size"] = cfg["size"]
        elif cfg["size"] != _applied["size"]:
            _applied["size"] = cfg["size"]
            set_size(cfg["size"])
        return {
            "cursor": cursor,
            "idle": platform_svc.idle_seconds(),
            "theme": _current_theme(),
            "mascot": cfg["mascot"],
            "cmds": cmds,
        }

    def dismiss(self):
        """Click on Hubi while a bubble or an alert is showing."""
        from . import reactions

        reactions.dismiss()

    def report_mood(self, name):
        if name in MOOD_NAMES:
            _report_mood(name)

    def drag_start(self):
        global _drag_thread, _drag_moved, _fallback_moved
        _drag_moved = 0.0
        _fallback_moved = 0.0
        if not platform_svc.overlay_native_drag():
            return {"native": False}
        start_cursor = platform_svc.cursor_pos()
        start_rect = platform_svc.overlay_rect(_window)
        if start_cursor is None or start_rect is None:
            return {"native": False}
        _drag_thread = threading.Thread(target=_drag_loop, args=(start_cursor, start_rect), daemon=True)
        _drag_thread.start()
        return {"native": True}

    def move_by(self, dx, dy):
        """Fallback drag when the platform can't read the cursor: the page
        reports CSS-pixel deltas of its own screenX/screenY."""
        global _fallback_moved
        r = platform_svc.overlay_rect(_window)
        if r is None:
            return
        s = platform_svc.overlay_dpi_scale(_window)
        _fallback_moved += math.hypot(dx, dy)
        platform_svc.overlay_set_rect(_window, r[0] + dx * s, r[1] + dy * s)

    def drag_result(self):
        """How far (CSS px) the pointer moved during the press, so the page
        can tell a click (< 4 px) from a drag."""
        thread = _drag_thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=1.0)
            return {"moved": _drag_moved}
        if _fallback_moved:
            _save_position()
            return {"moved": _fallback_moved}
        return {"moved": _drag_moved}


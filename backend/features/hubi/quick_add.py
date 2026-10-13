"""Ctrl+Alt+H: a small window to jot a task down from anywhere. Created at
runtime inside the Hubi process (never from Dev Hub)."""
import threading
import time

import webview

from core.platform import platform_svc

HOTKEY = "ctrl+alt+h"

_lock = threading.Lock()
_window = None
_base_url = None
_stop_hotkey = None
_stop_escape = None
_on_added = None


def _close():
    global _window
    # Let pywebview deliver the js_api call's return value before the page goes.
    time.sleep(0.15)
    with _lock:
        win, _window = _window, None
    _release_escape()
    platform_svc.hide_dim_overlay()
    if win is not None:
        try:
            win.destroy()
        except Exception:
            pass


def _on_closed():
    global _window
    _window = None
    _release_escape()
    platform_svc.hide_dim_overlay()


def _release_escape():
    global _stop_escape
    stop_fn, _stop_escape = _stop_escape, None
    if stop_fn:
        stop_fn()


def _grab_focus_and_escape(win):
    global _stop_escape
    # While the bar is open, Escape closes it wherever the focus ended up,
    # and the bar takes the keyboard focus from whatever app was active.
    if _stop_escape is None:
        _stop_escape = platform_svc.start_global_hotkey(
            "escape", lambda: threading.Thread(target=_close, daemon=True).start()
        )
    for _ in range(3):
        if platform_svc.force_foreground(win):
            break
        time.sleep(0.08)


def _on_shown():
    # Launcher-style: centered horizontally, in the upper third of the screen.
    win = _window
    if win is None:
        return
    platform_svc.round_window_corners(win, (0x2A, 0x2A, 0x30))
    platform_svc.show_dim_overlay(win, on_click=lambda: threading.Thread(target=_close, daemon=True).start())
    try:
        sw, sh = platform_svc.overlay_screen()["primary"]
        r = platform_svc.overlay_rect(win)
        if r:
            platform_svc.overlay_set_rect(win, (sw - r[2]) // 2, int(sh * 0.28))
    except Exception:
        pass
    _grab_focus_and_escape(win)


def _play_noting(task):
    # Hubi "writes it down": notepad + pencil, then a wink with a thumbs-up.
    from . import window

    window.push_cmd("mood", "listening", 1800)
    time.sleep(1.8)
    window.push_cmd("mood", "understood", 1400)
    window.push_cmd("bubble", f"📝 Noté : {task['text']}", 4000, "info")


class QuickApi:
    """js_api of hubi-quick.html (methods only, see window.HubiApi)."""

    def add(self, text):
        from . import tasks

        project, text = tasks.split_project_prefix(text)
        task = tasks.add(text, project)
        if task is None:
            return {"error": "Tâche vide"}
        if _on_added:
            _on_added()
        threading.Thread(target=_play_noting, args=(task,), daemon=True).start()
        threading.Thread(target=_close, daemon=True).start()
        return {"ok": True}

    def close(self):
        threading.Thread(target=_close, daemon=True).start()

    def list_projects(self):
        """Dev Hub's projects, for the "@projet" suggestions."""
        from pathlib import Path

        from app_config import load_config

        names = [Path(r.get("path") or "").name for r in load_config().get("repos", [])]
        return sorted({n for n in names if n}, key=str.lower)

    def resize(self, css_height):
        """Grow/shrink the bar to fit its project suggestions (top edge fixed)."""
        win = _window
        if win is None:
            return
        try:
            s = platform_svc.overlay_dpi_scale(win)
            r = platform_svc.overlay_rect(win)
            if r:
                platform_svc.overlay_set_rect(win, w=r[2], h=int(round(float(css_height) * s)))
        except Exception:
            pass

    def get_theme(self):
        # Colors Dev Hub snapshots into config (features/repos/settings.py).
        from app_config import load_config

        return load_config().get("theme_vars") or {}


def open_window():
    global _window
    with _lock:
        if _window is not None or _base_url is None:
            return
        # Opaque like the eyes window: never mix transparent and opaque
        # WebView2 windows in one process (that rendered windows solid black).
        _window = webview.create_window(
            "Hubi — nouvelle tâche",
            f"{_base_url}/hubi-quick.html",
            js_api=QuickApi(),
            width=460,
            height=76,
            frameless=True,
            easy_drag=True,
            shadow=False,
            focus=True,
            on_top=True,
            # The card fills the window; Windows 11 rounds the window itself.
            resizable=False,
            background_color="#0b0b0d",
        )
        _window.events.closed += _on_closed
        _window.events.shown += _on_shown


def start(base_url, on_added):
    """Register the global hotkey. Returns True if it is active."""
    global _base_url, _stop_hotkey, _on_added
    _base_url = base_url.rstrip("/")
    _on_added = on_added
    if _stop_hotkey is None:
        _stop_hotkey = platform_svc.start_global_hotkey(
            HOTKEY, lambda: threading.Thread(target=open_window, daemon=True).start()
        )
        if _stop_hotkey is None:
            print("[hubi] raccourci Ctrl+Alt+H indisponible (déjà pris ?)")
    return _stop_hotkey is not None


def stop():
    global _stop_hotkey
    stop_fn, _stop_hotkey = _stop_hotkey, None
    if stop_fn:
        stop_fn()
    _close()

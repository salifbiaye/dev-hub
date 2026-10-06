"""Linux browser: v1 simplified "one tab = one window" implementation.

WebView2-WinForms (what features/browser/windows/* builds on) has no
equivalent in GTK/WebKit2 -- replicating the same single-chrome-window,
multi-tab style would be a parallel multi-day rewrite that can't even be
tested from this Windows machine. Instead, every "open browser tab" call
just pops open a plain (non-frameless) pywebview window -- the OS window
manager handles move/resize/close/title bar natively, zero custom chrome
needed. No tabs, no address bar, no back/forward for this v1.
"""
import threading

import webview

from .. import history

# Mirrors features/browser/windows/window.py's _own_ui_base pattern. Kept
# as its own separate module-level global (rather than shared with the
# Windows module or moved into history.py) so the Windows code path stays
# byte-identical and untouched.
_own_ui_base = None

# Every window this module has opened, so close_all_preview_windows() can
# tear all of them down. No single "the" browser window on Linux since each
# open_browser_tab() call creates a brand new one.
_windows = []
_windows_lock = threading.Lock()


def set_own_ui_base(base):
    global _own_ui_base
    _own_ui_base = base


def get_own_ui_base():
    return _own_ui_base


def open_browser_tab(url=None, title=None):
    target_url = url
    if not target_url:
        target_url = history.start_page_url(_own_ui_base)
    else:
        history.record_visit(url, title)

    win = webview.create_window(
        title or "Dev Hub — Navigateur",
        target_url,
        width=1200,
        height=800,
        resizable=True,
    )

    with _windows_lock:
        _windows.append(win)

    def _on_closing():
        with _windows_lock:
            if win in _windows:
                _windows.remove(win)

    win.events.closing += _on_closing
    return {"ok": True}


def close_all_preview_windows():
    with _windows_lock:
        windows = list(_windows)
        _windows.clear()
    for win in windows:
        try:
            win.destroy()
        except Exception:
            pass


def push_theme_to_browser_window():
    # No-op on Linux: each window already gets the current theme baked into
    # its URL query string at creation time (via history.start_page_url()),
    # and unlike Windows there's no persistent chrome window whose live
    # theme needs pushing -- nothing here is long-lived/reused the way
    # browser.html's chrome window is on Windows.
    return

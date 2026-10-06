import json
import threading
import time

import webview

from app_config import APP_DATA_DIR, load_config
from core.platform import platform_svc

from .. import history

# Set once by main.py at startup -- the base URL (http://localhost:<port>)
# Dev Hub's own UI (and therefore browser.html/start.html) is served from.
_own_ui_base = None

# Dev Hub's own browser — a single genuine top-level pywebview window (no
# iframe/X-Frame-Options/cookie-partitioning restrictions at all), whose
# own WebView2 renders a standalone chrome page (frontend/public/browser.html:
# tab strip + address bar). Each tab's actual content is a *separate*
# WebView2 .NET control BrowserWindowApi adds directly to that window's
# Form (see _get_form), positioned under the chrome and shown/hidden by
# toggling .Visible — never destroyed on tab switch, so every open tab
# keeps running in the background exactly like a real browser tab.
#
# Two simpler designs were tried first and both had real WebView2/WinForms
# failure modes, confirmed independently:
#   - One top-level window per tab, created on demand: pywebview *can*
#     create windows after start() (it marshals the call onto the GUI
#     thread via Control.Invoke), but on the WinForms/WebView2 backend
#     this can stall the GUI thread long enough for Windows to report the
#     whole app as hung (confirmed via Event Viewer — "Application Hang"
#     for DevHub.exe right after clicking Ouvrir).
#   - A pool of windows pre-created hidden at startup to dodge that:
#     WebView2 initialized while a window has never actually been shown
#     renders permanently black afterwards, even after Show()/resize —
#     a documented WebView2 limitation (MicrosoftEdge/WebView2Feedback
#     #1077, #2983), not something fixable from pywebview's own API.
# Adding child WebView2 *controls* to a Form that's already genuinely
# shown sidesteps both: only one dynamic create_window() call ever
# happens (the chrome window itself), and no control is ever initialized
# while hidden.
_browser_window = None
_browser_api = None

# Guards window creation below — open_browser_tab() runs on a fresh
# background thread per call (pywebview spawns one per JS-API call), so
# two "Ouvrir" clicks close together could otherwise both see
# _browser_window as None and each create their own top-level window.
_browser_window_lock = threading.Lock()


def set_own_ui_base(base):
    global _own_ui_base
    _own_ui_base = base


def get_own_ui_base():
    return _own_ui_base


def _preview_window_geometry():
    # If the main window is maximized (its width == the full screen width,
    # which is the common case), "just to its right" lands past the right
    # edge of the display — the window was created fine but sat entirely
    # off-screen, unreachable and looking like nothing happened at all.
    # Clamped against the actual screen size so it always lands visible,
    # overlapping the main window if there's genuinely no room beside it.
    screen_w, screen_h = 1920, 1080
    try:
        screens = webview.screens
        if screens:
            screen_w, screen_h = screens[0].width, screens[0].height
    except Exception:
        pass

    width, height = 900, 700
    x, y = 100, 100
    try:
        main = webview.windows[0]
        x, y, height = main.x + main.width, main.y, main.height
    except Exception:
        pass

    x = max(0, min(x, screen_w - width))
    y = max(0, min(y, screen_h - height))
    return x, y, width, height


def browser_profile_dir():
    d = APP_DATA_DIR / "browser_profile"
    d.mkdir(parents=True, exist_ok=True)
    return d


def push_theme_to_browser_window():
    # Called from set_theme() right after the main window's own theme
    # switch, on its own thread — a tiny wait lets that switch's
    # data-theme attribute actually land before this reads computed
    # styles back off it.
    time.sleep(0.15)
    if _browser_window is None:
        return
    vars_json = json.dumps(history.read_theme_vars())
    try:
        _browser_window.evaluate_js(f"window.__browserOnTheme && window.__browserOnTheme({vars_json})")
    except Exception:
        pass
    # The chrome (browser.html) picks this up via the call above, but a
    # start.html tab has its own separate WebView2 control with no js_api
    # bridge at all — it only ever read the theme once, baked into its
    # query string at open time. Without this it stays on whatever theme
    # was active when it was opened until the tab is closed and reopened.
    if _browser_api is not None:
        _browser_api.push_theme_to_start_tabs(vars_json)


def _apply_browser_window_icon(win, theme):
    # Mirrors icons.apply_window_icon() for the main window, but targeted
    # at this specific secondary window (webview.windows[0] there would be
    # the wrong window). No retry loop: unlike at app startup, this window
    # is created well after webview.start()'s message loop is already
    # pumping, and BrowserWindowApi.new_tab()/other methods already rely on
    # the native form resolving synchronously right after create_window()
    # returns for secondary windows on this platform.
    import icons

    ico_path = icons.theme_icon_path(icons.THEME_ACCENTS.get(theme, icons.THEME_ACCENTS["dark"]))
    platform_svc.apply_window_icon(win, ico_path)


def ensure_browser_window():
    # Caller must hold _browser_window_lock.
    global _browser_window, _browser_api
    if _browser_window is not None:
        _browser_window.show()
        return

    from .api import BrowserWindowApi

    x, y, width, height = _preview_window_geometry()
    browser_url = f"{_own_ui_base}/browser.html"
    # BrowserWindowApi needs the Window to call evaluate_js()/minimize()/
    # etc, but create_window() needs the js_api object up front — break the
    # cycle by handing it a bare instance first and filling in ._win right
    # after, before the page has had any chance to load and call back in.
    browser_api = BrowserWindowApi(None)
    win = webview.create_window(
        "Dev Hub — Navigateur",
        browser_url,
        js_api=browser_api,
        x=x,
        y=y,
        width=width,
        height=height,
        min_size=(360, 300),
        frameless=True,
        easy_drag=False,
        background_color="#0a0a0c",
    )
    browser_api._win = win
    _browser_window = win
    _browser_api = browser_api
    # Win+Arrow / Aero Snap support was attempted twice for this frameless
    # window and reverted both times:
    #   1. Just restoring WS_THICKFRAME (for snap eligibility) made Windows
    #      reserve its standard resizable-border non-client area at the
    #      top of the window — a visible gap above the tab strip.
    #   2. Fixing that gap via a WM_NCCALCSIZE WndProc override (real
    #      native subclassing through ctypes SetWindowLongPtrW) removed
    #      the gap, but interacting with this window's own F11 fullscreen
    #      toggle left it with a visible gray border and, worse, no longer
    #      resizable at all — a functional regression well past what a
    #      keyboard-shortcut nicety is worth. Reverted back to no snap
    #      support rather than ship a broken resize.
    # Not worth a third attempt without a way to test interactively.
    _apply_browser_window_icon(win, load_config().get("theme", "dark"))

    def _on_closing():
        global _browser_window, _browser_api
        _browser_window = None
        _browser_api = None

    win.events.closing += _on_closing


def close_all_preview_windows():
    global _browser_window, _browser_api
    if _browser_window is not None:
        try:
            _browser_window.destroy()
        except Exception:
            pass
    _browser_window = None
    _browser_api = None


def get_browser_api():
    return _browser_api

import threading
import webbrowser

import webview

from core.platform import platform_svc

_window_maximized = False


def _is_window_fullscreen(win):
    return platform_svc.is_window_fullscreen(win)


def _set_fullscreen(win, value):
    if _is_window_fullscreen(win) == value:
        return
    win.toggle_fullscreen()
    # OS-level fullscreen only hides the Windows taskbar — "like a browser"
    # also means Dev Hub's own chrome (tabs, header buttons) should
    # disappear, which only the frontend can do. There's no pywebview event
    # for this, so the new state is pushed into the page directly;
    # toggle_fullscreen() is synchronous (it Invokes onto the UI thread and
    # blocks until done), so is_fullscreen is already current here.
    is_fs = _is_window_fullscreen(win)
    win.evaluate_js(f"window.dispatchEvent(new CustomEvent('devhub-fullscreen', {{detail: {str(is_fs).lower()}}}))")


def start_fullscreen_watch():
    from features.browser.windows import window as browser_window

    platform_svc.start_fullscreen_hotkey_watch(
        get_main_window=lambda: webview.windows[0],
        get_browser_window=lambda: browser_window._browser_window,
        set_fullscreen=_set_fullscreen,
        is_fullscreen=_is_window_fullscreen,
    )


def kill_all_running():
    from features.processes.run_configs import all_running
    from features.terminal import sessions as terminal_sessions

    terminal_sessions.kill_all_running()
    all_running().clear()


class WindowChromeMixin:
    # Frameless window (custom title bar) has no native min/max/close chrome,
    # so the React-drawn buttons drive these directly.
    def minimize_window(self):
        webview.windows[0].minimize()
        return {"ok": True}

    def toggle_maximize_window(self):
        global _window_maximized
        w = webview.windows[0]
        if _window_maximized:
            w.restore()
            _window_maximized = False
        else:
            w.maximize()
            _window_maximized = True
        return {"ok": True, "maximized": _window_maximized}

    def close_window(self):
        webview.windows[0].destroy()
        return {"ok": True}

    def open_external(self, url):
        if not url:
            return {"ok": False, "error": "URL vide"}
        try:
            webbrowser.open(url)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def copy_to_clipboard(self, text):
        return platform_svc.clipboard_copy(text)

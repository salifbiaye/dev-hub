import ctypes
import ctypes.wintypes as wintypes
import time

import win32gui


class _MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", wintypes.POINT),
    ]


_WM_HOTKEY = 0x0312
_VK_F11 = 0x7A
_VK_ESCAPE = 0x1B
_F11_HOTKEY_ID = 1
_ESCAPE_HOTKEY_ID = 2
_PM_REMOVE = 1


def is_window_fullscreen(win):
    from webview.platforms.winforms import BrowserView

    form = BrowserView.instances.get(win.uid)
    return bool(getattr(form, "is_fullscreen", False)) if form else False


def start_fullscreen_hotkey_watch(get_main_window, get_browser_window, set_fullscreen, is_fullscreen):
    # A page-level JS keydown listener can't catch F11/Escape while focus
    # is inside the Processus preview iframe — that's a separate document,
    # so its key events never reach the parent window's listeners at all.
    # RegisterHotKey with hwnd=None claims the key for the calling
    # *thread* system-wide, which would otherwise steal it from every
    # other app (browsers included, and Escape is far too common a key
    # elsewhere) even while Dev Hub sits in the background — so both are
    # only actually registered while Dev Hub is the foreground window,
    # checked on the same loop that drains the hotkey messages. Escape
    # only ever exits fullscreen, never enters it, so it doesn't fight
    # with Escape's normal JS-side job of closing modals when not
    # fullscreen (a global hotkey firing doesn't suppress the key from
    # still reaching the focused control's own handlers too).
    user32 = ctypes.windll.user32
    msg = _MSG()
    registered = False
    focused_win = None  # whichever of the two windows is foreground right now
    try:
        while True:
            try:
                main_hwnd = win32gui.FindWindow(None, "Dev Hub")
            except Exception:
                main_hwnd = None
            try:
                browser_hwnd = win32gui.FindWindow(None, "Dev Hub — Navigateur")
            except Exception:
                browser_hwnd = None

            foreground = win32gui.GetForegroundWindow()
            if main_hwnd and foreground == main_hwnd:
                focused_win = get_main_window()
            elif browser_hwnd and foreground == browser_hwnd:
                focused_win = get_browser_window()
            else:
                focused_win = None
            focused = focused_win is not None

            if focused and not registered:
                registered = bool(user32.RegisterHotKey(None, _F11_HOTKEY_ID, 0, _VK_F11))
                registered = bool(user32.RegisterHotKey(None, _ESCAPE_HOTKEY_ID, 0, _VK_ESCAPE)) and registered
            elif not focused and registered:
                user32.UnregisterHotKey(None, _F11_HOTKEY_ID)
                user32.UnregisterHotKey(None, _ESCAPE_HOTKEY_ID)
                registered = False

            while user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, _PM_REMOVE):
                if msg.message != _WM_HOTKEY:
                    continue
                try:
                    win = focused_win or get_main_window()
                    if msg.wParam == _F11_HOTKEY_ID:
                        set_fullscreen(win, not is_fullscreen(win))
                    elif msg.wParam == _ESCAPE_HOTKEY_ID:
                        set_fullscreen(win, False)
                except Exception:
                    pass

            time.sleep(0.15)
    finally:
        if registered:
            user32.UnregisterHotKey(None, _F11_HOTKEY_ID)
            user32.UnregisterHotKey(None, _ESCAPE_HOTKEY_ID)

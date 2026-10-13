"""Make Dev Hub's frameless pywebview windows "real" windows to Windows:
Aero Snap (drag to an edge, Win+Arrow), edge resize, minimize/maximize
animations -- while keeping our own HTML title bar.

Same idea as Electron/Claude Desktop and Windows Terminal: the window keeps a
normal captioned, sizable style (WS_CAPTION | WS_THICKFRAME), and
WM_NCCALCSIZE removes only the *top* non-client strip (the native title bar),
so our page draws there instead.

Left/right/bottom resize borders are deliberately left to Windows: on 10/11
they are invisible and sit outside the visible window edge, i.e. outside the
WebView2 control. That matters because WebView2 covers the entire client
area -- a custom WM_NCHITTEST on the form never even fires over it (Windows
asks the WebView2 child window, not us), which is why the earlier
"report HTLEFT/HTRIGHT ourselves" attempt could never resize anything.

Moving the window is not done here: the page hands title-bar presses to the
OS move loop (window_drag.py). With this style in place that loop also
performs Aero Snap.

Earlier attempts and what each got wrong, so nobody walks into them again:
  1. WS_THICKFRAME alone -> Windows reserved its top border: visible gap.
  2. WM_NCCALCSIZE covering the whole frame + no working hit-test -> no resize.
  3. Style + SWP_FRAMECHANGED applied *before* the window was subclassed ->
     Windows computed a real caption with the default proc: double title bar.
     Here the subclass is installed first, and only then the frame recomputed.
"""
import ctypes
import ctypes.wintypes as wintypes

GWL_STYLE = -16
GWL_WNDPROC = -4

WS_CAPTION = 0x00C00000
WS_THICKFRAME = 0x00040000
WS_MINIMIZEBOX = 0x00020000
WS_MAXIMIZEBOX = 0x00010000

SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010
SWP_FRAMECHANGED = 0x0020

WM_NCCALCSIZE = 0x0083

SM_CYSIZEFRAME = 33
SM_CXPADDEDBORDER = 92

DWMWA_BORDER_COLOR = 34

user32 = ctypes.windll.user32
dwmapi = ctypes.windll.dwmapi

user32.GetWindowLongPtrW.restype = ctypes.c_void_p
user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.SetWindowLongPtrW.restype = ctypes.c_void_p
user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_void_p]
user32.CallWindowProcW.restype = ctypes.c_ssize_t
user32.CallWindowProcW.argtypes = [ctypes.c_void_p, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.SetWindowPos.argtypes = [
    wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT,
]
user32.IsZoomed.argtypes = [wintypes.HWND]
user32.IsZoomed.restype = wintypes.BOOL
user32.GetDpiForWindow.argtypes = [wintypes.HWND]
user32.GetDpiForWindow.restype = ctypes.c_uint
user32.GetSystemMetricsForDpi.argtypes = [ctypes.c_int, ctypes.c_uint]
user32.GetSystemMetricsForDpi.restype = ctypes.c_int

WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)


class _NCCALCSIZE_PARAMS(ctypes.Structure):
    _fields_ = [("rgrc", wintypes.RECT * 3), ("lppos", ctypes.c_void_p)]


# hwnd -> (callback, original proc). The callback object must stay referenced
# for the window's whole life, or ctypes frees it and Windows calls into freed
# memory -- a hard crash of the whole app.
_subclassed = {}


def _form(win):
    from webview.platforms.winforms import BrowserView

    return BrowserView.instances.get(win.uid)


# Neutral gray (COLORREF is 0x00BBGGRR -> #404048): marks the window's edge on
# dark and light themes alike. Windows 11 only; older versions ignore it.
WINDOW_BORDER_COLOR = 0x00484040


def _apply_dwm_border(hwnd):
    # Re-applied on every frame recalculation: pywebview's toggle_fullscreen()
    # sets "no border" entering fullscreen and resets it to the system default
    # when leaving, which would otherwise override ours. In fullscreen itself
    # NCCALCSIZE returns early, so its "no border" is left alone there.
    try:
        value = ctypes.c_uint(WINDOW_BORDER_COLOR)
        dwmapi.DwmSetWindowAttribute(wintypes.HWND(hwnd), DWMWA_BORDER_COLOR, ctypes.byref(value), ctypes.sizeof(value))
    except Exception:
        pass


def _maximized_top_inset(hwnd):
    # A maximized sizable window is positioned with its frame hanging off the
    # screen; without this the top of our page would be cut off.
    dpi = user32.GetDpiForWindow(hwnd) or 96
    return user32.GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) + user32.GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)


def _install(form):
    hwnd = form.Handle.ToInt64()
    if hwnd in _subclassed:
        return
    old_proc = user32.GetWindowLongPtrW(hwnd, GWL_WNDPROC)

    def wnd_proc(h, msg, wparam, lparam):
        try:
            if msg == WM_NCCALCSIZE and wparam:
                return _on_nccalcsize(h, msg, wparam, lparam)
        except Exception:
            pass
        return user32.CallWindowProcW(old_proc, h, msg, wparam, lparam)

    def _on_nccalcsize(h, msg, wparam, lparam):
        # pywebview's own F11 fullscreen sizes the window to exactly the
        # screen: the whole window must be client area, no frame at all.
        if getattr(form, "is_fullscreen", False):
            return 0
        params = ctypes.cast(ctypes.c_void_p(lparam), ctypes.POINTER(_NCCALCSIZE_PARAMS)).contents
        original_top = params.rgrc[0].top
        result = user32.CallWindowProcW(old_proc, h, msg, wparam, lparam)
        # Keep Windows' left/right/bottom (invisible resize borders), drop
        # only the caption at the top.
        if user32.IsZoomed(h):
            params.rgrc[0].top = original_top + _maximized_top_inset(h)
        else:
            params.rgrc[0].top = original_top
        _apply_dwm_border(h)
        return result

    callback = WNDPROC(wnd_proc)
    # Subclass first, *then* change the style and recompute the frame, so the
    # very first frame calculation already goes through wnd_proc.
    user32.SetWindowLongPtrW(hwnd, GWL_WNDPROC, ctypes.cast(callback, ctypes.c_void_p))
    _subclassed[hwnd] = (callback, old_proc)

    style = user32.GetWindowLongPtrW(hwnd, GWL_STYLE) or 0
    style |= WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
    user32.SetWindowLongPtrW(hwnd, GWL_STYLE, style)
    _apply_dwm_border(hwnd)
    user32.SetWindowPos(
        hwnd, None, 0, 0, 0, 0,
        SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
    )


def enable_native_frame(win):
    try:
        from System import Func, Type

        form = _form(win)
        if not form:
            return False
        # Subclassing and style changes belong on the window's own (UI) thread.
        form.Invoke(Func[Type](lambda: _install(form)))
        return True
    except Exception:
        return False


def is_maximized(win):
    try:
        form = _form(win)
        if not form:
            return None
        return bool(user32.IsZoomed(form.Handle.ToInt64()))
    except Exception:
        return None

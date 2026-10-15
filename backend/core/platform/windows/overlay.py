"""Win32 plumbing for Hubi's floating widget window.

Everything is in physical pixels (pywebview marks the process DPI-aware), and
every call is wrapped so a failure degrades to "feature unavailable" instead
of crashing the app.
"""
import ctypes
from ctypes import wintypes

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_LAYERED = 0x00080000
WS_EX_NOACTIVATE = 0x08000000

HWND_TOPMOST = -1
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010

SW_HIDE = 0
SW_SHOWNOACTIVATE = 4

VK_LBUTTON = 0x01

SM_CXSCREEN = 0
SM_CYSCREEN = 1
SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79

user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetWindowRect.restype = wintypes.BOOL
user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
user32.SetWindowPos.restype = wintypes.BOOL
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.ShowWindow.restype = wintypes.BOOL
user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
user32.GetCursorPos.restype = wintypes.BOOL
user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
user32.GetAsyncKeyState.restype = ctypes.c_short
user32.GetSystemMetrics.argtypes = [ctypes.c_int]
user32.GetSystemMetrics.restype = ctypes.c_int
user32.GetDpiForWindow.argtypes = [wintypes.HWND]
user32.GetDpiForWindow.restype = wintypes.UINT
user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
user32.SetWindowLongPtrW.restype = ctypes.c_ssize_t


class _LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


user32.GetLastInputInfo.argtypes = [ctypes.POINTER(_LASTINPUTINFO)]
user32.GetLastInputInfo.restype = wintypes.BOOL
kernel32.GetTickCount.restype = wintypes.DWORD


def _form(win):
    if getattr(win, "hwnd", None):
        return None
    from webview.platforms.winforms import BrowserView

    return BrowserView.instances.get(win.uid)


def _hwnd(win):
    # The transparent composition window (composition_window.py) has no
    # WinForms form, just its own hwnd.
    if getattr(win, "hwnd", None):
        return int(win.hwnd)
    form = _form(win)
    if form is None:
        return None
    return form.Handle.ToInt64()


def prepare(win):
    form = _form(win)
    if form is None:
        return False
    # No color-key transparency (TransparencyKey / WS_EX_LAYERED) on purpose:
    # it never reached WebView2's content — the square corners around the
    # rounded face stayed a gray box — and it made the whole widget
    # click-through (hit-testing fell to the window underneath), so it could
    # not be dragged or clicked. Instead the face fills the window and
    # Windows 11 rounds the window itself (DWM clips the whole window,
    # WebView2 content included).
    try:
        from System import Func, Type
        from System.Drawing import Color

        def _setup():
            form.BackColor = Color.Black

        form.Invoke(Func[Type](_setup))
    except Exception:
        pass

    hwnd = form.Handle.ToInt64()
    try:
        style = user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
        # TOOLWINDOW keeps the widget out of the taskbar and Alt-Tab;
        # NOACTIVATE (already set by pywebview's focus=False) keeps it from
        # ever stealing the keyboard focus.
        style = (style | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) & ~WS_EX_LAYERED
        user32.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style)
        # The taskbar only re-reads the style on a hide/show cycle.
        user32.ShowWindow(hwnd, SW_HIDE)
        user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
        user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
        _dwm_round_no_border(hwnd)
        return True
    except Exception:
        return False


def force_foreground(win):
    """Give `win` the keyboard focus even though this process is in the
    background (Windows' foreground lock otherwise leaves the focus in
    whatever app was active, so Escape and typing went there)."""
    hwnd = _hwnd(win)
    if not hwnd:
        return False
    try:
        kernel32 = ctypes.windll.kernel32
        fg = user32.GetForegroundWindow()
        fg_thread = user32.GetWindowThreadProcessId(fg, None)
        me = kernel32.GetCurrentThreadId()
        attached = fg_thread and fg_thread != me and user32.AttachThreadInput(fg_thread, me, True)
        try:
            user32.BringWindowToTop(wintypes.HWND(hwnd))
            user32.SetForegroundWindow(wintypes.HWND(hwnd))
            user32.SetFocus(wintypes.HWND(hwnd))
        finally:
            if attached:
                user32.AttachThreadInput(fg_thread, me, False)
        return user32.GetForegroundWindow() == hwnd
    except Exception:
        return False


def round_corners(win, border_rgb=None):
    hwnd = _hwnd(win)
    if not hwnd:
        return False
    try:
        dwm = ctypes.windll.dwmapi
        round_ = ctypes.c_uint(2)  # DWMWCP_ROUND
        dwm.DwmSetWindowAttribute(wintypes.HWND(hwnd), 33, ctypes.byref(round_), ctypes.sizeof(round_))
        if border_rgb:
            r, g, b = border_rgb
            color = ctypes.c_uint(r | (g << 8) | (b << 16))  # COLORREF 0x00BBGGRR
            dwm.DwmSetWindowAttribute(wintypes.HWND(hwnd), 34, ctypes.byref(color), ctypes.sizeof(color))
        return True
    except Exception:
        return False


def _dwm_round_no_border(hwnd):
    # Windows 11 only (silently ignored on 10): native rounded corners, and
    # no thin gray outline around the widget.
    try:
        dwm = ctypes.windll.dwmapi
        round_ = ctypes.c_uint(2)  # DWMWCP_ROUND
        dwm.DwmSetWindowAttribute(wintypes.HWND(hwnd), 33, ctypes.byref(round_), ctypes.sizeof(round_))
        none = ctypes.c_uint(0xFFFFFFFE)  # DWMWA_COLOR_NONE
        dwm.DwmSetWindowAttribute(wintypes.HWND(hwnd), 34, ctypes.byref(none), ctypes.sizeof(none))
    except Exception:
        pass


def rect(win):
    hwnd = _hwnd(win)
    if not hwnd:
        return None
    r = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(r)):
        return None
    return (r.left, r.top, r.right - r.left, r.bottom - r.top)


def set_rect(win, x=None, y=None, w=None, h=None):
    hwnd = _hwnd(win)
    if not hwnd:
        return False
    cur = rect(win)
    if cur is None:
        return False
    flags = SWP_NOZORDER | SWP_NOACTIVATE
    nx = cur[0] if x is None else int(x)
    ny = cur[1] if y is None else int(y)
    nw = cur[2] if w is None else int(w)
    nh = cur[3] if h is None else int(h)
    ok = bool(user32.SetWindowPos(hwnd, None, nx, ny, nw, nh, flags))
    if (nw, nh) != (cur[2], cur[3]) and hasattr(win, "resize"):
        win.resize(nw, nh)  # composition window: WebView2 bounds follow
    return ok


def set_hit_region(win, rects):
    """Clickable (and, for the composition window, visible) area = these
    rounded rects [x, y, w, h, radius] in window pixels; elsewhere clicks go
    to the windows below."""
    hwnd = _hwnd(win)
    if not hwnd:
        return False
    gdi32 = ctypes.windll.gdi32
    gdi32.CreateRoundRectRgn.restype = wintypes.HRGN
    gdi32.CreateRoundRectRgn.argtypes = [ctypes.c_int] * 6
    gdi32.CombineRgn.argtypes = [wintypes.HRGN, wintypes.HRGN, wintypes.HRGN, ctypes.c_int]
    gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
    user32.SetWindowRgn.argtypes = [wintypes.HWND, wintypes.HRGN, wintypes.BOOL]
    region = None
    for x, y, w, h, r in rects:
        part = gdi32.CreateRoundRectRgn(int(x), int(y), int(x + w) + 1, int(y + h) + 1, int(r * 2), int(r * 2))
        if region is None:
            region = part
        else:
            gdi32.CombineRgn(region, region, part, 2)  # RGN_OR
            gdi32.DeleteObject(part)
    # The window owns the region from here on (no DeleteObject).
    return bool(user32.SetWindowRgn(hwnd, region, True))


def set_visible(win, visible):
    hwnd = _hwnd(win)
    if not hwnd:
        return False
    user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE if visible else SW_HIDE)
    if visible:
        keep_on_top(win)
    return True


def set_form_visible(win, visible):
    """Show/hide through WinForms itself (form.Show/Hide on its thread): unlike
    a bare ShowWindow, this also tells WebView2 it is visible — otherwise a
    window created hidden stays blank once shown."""
    form = _form(win)
    if form is None:
        return set_visible(win, visible)
    try:
        from System import Func, Type

        def _apply():
            if visible:
                form.Show()
            else:
                form.Hide()

        form.Invoke(Func[Type](_apply))
        if visible:
            keep_on_top(win)
        return True
    except Exception:
        return False


def keep_on_top(win):
    hwnd = _hwnd(win)
    if hwnd:
        user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)


def dpi_scale(win):
    hwnd = _hwnd(win)
    if not hwnd:
        return 1.0
    try:
        return user32.GetDpiForWindow(hwnd) / 96
    except Exception:
        return 1.0


def screen():
    return {
        "primary": (user32.GetSystemMetrics(SM_CXSCREEN), user32.GetSystemMetrics(SM_CYSCREEN)),
        "virtual": (
            user32.GetSystemMetrics(SM_XVIRTUALSCREEN),
            user32.GetSystemMetrics(SM_YVIRTUALSCREEN),
            user32.GetSystemMetrics(SM_CXVIRTUALSCREEN),
            user32.GetSystemMetrics(SM_CYVIRTUALSCREEN),
        ),
    }


def cursor_pos():
    pt = wintypes.POINT()
    if not user32.GetCursorPos(ctypes.byref(pt)):
        return None
    return (pt.x, pt.y)


def left_button_down():
    return bool(user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000)


def idle_seconds():
    info = _LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(_LASTINPUTINFO)
    if not user32.GetLastInputInfo(ctypes.byref(info)):
        return None
    # Both are 32-bit millisecond tick counts that wrap together, so the
    # unsigned difference stays right across the wrap.
    return ((kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF) / 1000.0

"""Full-screen dimming veil behind Hubi's quick-add bar (Spotlight/Raycast
style). A plain WinForms Form — no WebView2 in it, so Opacity really works —
shown without taking the focus, fading in."""
import ctypes
from ctypes import wintypes

from .overlay import _form

SW_SHOWNOACTIVATE = 4
HWND_TOPMOST = wintypes.HWND(-1)
SWP_NOMOVE, SWP_NOSIZE, SWP_NOACTIVATE = 0x0002, 0x0001, 0x0010

TARGET_OPACITY = 0.55
FADE_STEPS = 8
FADE_INTERVAL_MS = 15

_state = {"form": None, "owner": None}
_user32 = ctypes.windll.user32


def show(owner_win, on_click=None):
    owner = _form(owner_win)
    if owner is None:
        return False
    try:
        from System import EventHandler, Func, Type
        from System.Drawing import Color
        import System.Windows.Forms as WF

        def _create():
            if _state["form"] is not None:
                return
            veil = WF.Form()
            veil.FormBorderStyle = getattr(WF.FormBorderStyle, "None")
            veil.ShowInTaskbar = False
            veil.BackColor = Color.Black
            veil.Opacity = 0.0
            veil.StartPosition = WF.FormStartPosition.Manual
            veil.Bounds = WF.SystemInformation.VirtualScreen
            if on_click is not None:
                veil.MouseDown += lambda s, e: on_click()
            hwnd = veil.Handle.ToInt64()
            # Never activate the veil: the bar closes itself when it loses focus.
            _user32.ShowWindow(wintypes.HWND(hwnd), SW_SHOWNOACTIVATE)
            veil.Visible = True
            _user32.SetWindowPos(wintypes.HWND(hwnd), HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
            # Keep the bar above the veil.
            owner_hwnd = owner.Handle.ToInt64()
            _user32.SetWindowPos(wintypes.HWND(owner_hwnd), HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)

            timer = WF.Timer()
            timer.Interval = FADE_INTERVAL_MS
            step = TARGET_OPACITY / FADE_STEPS

            def _tick(sender, args):
                if veil.IsDisposed:
                    timer.Stop()
                    return
                veil.Opacity = min(TARGET_OPACITY, veil.Opacity + step)
                if veil.Opacity >= TARGET_OPACITY:
                    timer.Stop()

            timer.Tick += EventHandler(_tick)
            timer.Start()
            _state["form"], _state["owner"] = veil, owner

        owner.Invoke(Func[Type](_create))
        return True
    except Exception:
        return False


def hide():
    veil, owner = _state["form"], _state["owner"]
    _state["form"] = _state["owner"] = None
    if veil is None:
        return False
    try:
        from System import Func, Type

        def _close():
            try:
                veil.Close()
                veil.Dispose()
            except Exception:
                pass

        # The bar may already be gone; the veil was created on the same UI
        # thread, so it can marshal its own close.
        target = veil if not veil.IsDisposed else owner
        target.Invoke(Func[Type](_close))
        return True
    except Exception:
        return False

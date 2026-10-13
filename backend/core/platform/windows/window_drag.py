import ctypes
import ctypes.wintypes as wintypes

WM_NCLBUTTONDOWN = 0x00A1
HTCAPTION = 2
VK_LBUTTON = 0x01

_user32 = ctypes.windll.user32
_user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
_user32.SendMessageW.restype = ctypes.c_ssize_t


def start_native_drag(win):
    # pywebview's own drag replays every JS mousemove through the bridge into
    # SetWindowPos: it lags behind the cursor, and stops dead as soon as the
    # cursor outruns the window (mousemove only fires inside the page).
    # Telling Windows the press landed on a caption hands the drag to the
    # OS's own move loop instead -- the same thing a native title bar does.
    try:
        from System import Func, Type
        from webview.platforms.winforms import BrowserView

        form = BrowserView.instances.get(win.uid)
        if not form:
            return False
        hwnd = form.Handle.ToInt64()

        def _drag():
            # The request crosses the JS bridge and the UI thread's queue; if
            # the button is already up by now, WM_NCLBUTTONDOWN would put the
            # window in keyboard-move mode (looks frozen). Only drag a press
            # that is still held.
            if not (_user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000):
                return
            # WebView2 holds mouse capture for the press; the move loop needs it.
            _user32.ReleaseCapture()
            _user32.SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0)

        # BeginInvoke: the move loop is modal and lasts the whole drag, no
        # reason to keep this bridge thread blocked on it.
        form.BeginInvoke(Func[Type](_drag))
        return True
    except Exception:
        return False

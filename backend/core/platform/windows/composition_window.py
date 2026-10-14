"""A truly transparent WebView2 window (Hubi's « mascotte seule » mode).

pywebview hosts WebView2 in a WinForms form, which always paints an opaque
rectangle: color keys, DWM frame extension or blur-behind never reach
WebView2's content (docs/hubi-sans-cadre.md). Here WebView2 is hosted in
*composition* mode instead, like Electron:

- a plain Win32 popup created with WS_EX_NOREDIRECTIONBITMAP (no surface of
  its own), topmost, tool window, never activated;
- a DirectComposition target on it, whose root visual receives WebView2's
  rendering (CoreWebView2CompositionController.RootVisualTarget) — pixels the
  page leaves transparent show the desktop, soft shadows included;
- mouse input forwarded by hand (SendMouseInput): in this mode WebView2 does
  not get window messages itself;
- the page's `window.pywebview.api` is recreated on top of WebView2's own
  messages (postMessage / WebMessageReceived), so the page code is the same
  as in the framed window.

Clicks outside what is drawn go to the windows below thanks to a window
region (set_hit_region in overlay.py), which also clips the rendering.
Runs its own STA thread with a WinForms message loop.
"""
import ctypes
import json
import os
import threading
from ctypes import wintypes

user32 = ctypes.windll.user32

WS_POPUP = 0x80000000
WS_EX_TOPMOST, WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE = 0x00000008, 0x00000080, 0x08000000
WS_EX_NOREDIRECTIONBITMAP = 0x00200000
WM_DESTROY, WM_CLOSE, WM_MOUSEACTIVATE = 0x0002, 0x0010, 0x0021
WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP = 0x0200, 0x0201, 0x0202
WM_RBUTTONDOWN, WM_RBUTTONUP, WM_MOUSELEAVE = 0x0204, 0x0205, 0x02A3
MA_NOACTIVATE = 3
SW_SHOWNOACTIVATE = 4
CLASS_NAME = "DevHubHubiComposition"

WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.DefWindowProcW.restype = ctypes.c_ssize_t
user32.CreateWindowExW.restype = wintypes.HWND
user32.CreateWindowExW.argtypes = [
    wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_int, ctypes.c_int,
    ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID,
]


class _WNDCLASSEXW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.UINT), ("style", wintypes.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HBRUSH), ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR), ("hIconSm", wintypes.HICON),
    ]


# ---------------------------------------------------------------- DirectComposition (COM via vtables)


class _GUID(ctypes.Structure):
    _fields_ = [("a", wintypes.DWORD), ("b", wintypes.WORD), ("c", wintypes.WORD), ("d", ctypes.c_ubyte * 8)]


def _guid(text):
    g = _GUID()
    ctypes.oledll.ole32.CLSIDFromString(ctypes.c_wchar_p(text), ctypes.byref(g))
    return g


def _vcall(ptr, index, *argtypes):
    vtable = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    return ctypes.WINFUNCTYPE(ctypes.HRESULT, ctypes.c_void_p, *argtypes)(vtable[index])


class _DComp:
    """IDCompositionDevice -> target on the window -> one root visual."""

    def __init__(self, hwnd):
        self.device = ctypes.c_void_p()
        ctypes.oledll.dcomp.DCompositionCreateDevice2(
            None, ctypes.byref(_guid("{C37EA93A-E7AA-450D-B16F-9746CB0407F3}")), ctypes.byref(self.device)
        )
        # IDCompositionDevice vtable: 3 Commit, 6 CreateTargetForHwnd, 7 CreateVisual.
        self.target = ctypes.c_void_p()
        _vcall(self.device, 6, wintypes.HWND, wintypes.BOOL, ctypes.POINTER(ctypes.c_void_p))(
            self.device, hwnd, True, ctypes.byref(self.target)
        )
        self.visual = ctypes.c_void_p()
        _vcall(self.device, 7, ctypes.POINTER(ctypes.c_void_p))(self.device, ctypes.byref(self.visual))
        _vcall(self.target, 3, ctypes.c_void_p)(self.target, self.visual)  # IDCompositionTarget::SetRoot

    def commit(self):
        _vcall(self.device, 3)(self.device)

    def release(self):
        for ptr in (self.visual, self.target, self.device):
            if ptr:
                try:
                    _vcall(ptr, 2)(ptr)  # IUnknown::Release
                except Exception:
                    pass


# ---------------------------------------------------------------- page bridge

# window.pywebview.api.<name>(...args) -> postMessage({id, name, args}) ->
# Python calls api.<name>(*args) -> postMessage({id, result | error}).
_BRIDGE_JS = r"""
(() => {
  if (window.pywebview) return
  const pending = new Map()
  let seq = 0
  window.chrome.webview.addEventListener('message', (e) => {
    let m
    try { m = JSON.parse(e.data) } catch (err) { return }
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.error) p.reject(new Error(m.error))
    else p.resolve(m.result)
  })
  const api = new Proxy({}, {
    get: (_, name) => typeof name !== 'string' ? undefined : (...args) => new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      window.chrome.webview.postMessage(JSON.stringify({ id, name, args }))
    }),
  })
  window.pywebview = { api, composition: true }
})()
"""


def _load_assemblies():
    """WebView2's .NET assemblies ship with pywebview; this window may exist
    before pywebview loads them itself."""
    import clr
    from webview.util import interop_dll_path

    clr.AddReference("System.Windows.Forms")
    clr.AddReference("System.Drawing")
    clr.AddReference(interop_dll_path("Microsoft.Web.WebView2.Core.dll"))


class CompositionWindow:
    """Transparent topmost WebView2 popup. Physical-pixel geometry.

    `api`: object whose public methods the page calls through pywebview.api.
    `on_ready()` runs once the page is navigating; `on_closed()` when gone.
    """

    _wndproc = None  # keeps the ctypes callback alive (one class per process)
    _instances = {}

    def __init__(self, url, rect, api, user_data_dir, on_ready=None, on_closed=None):
        self.url = url
        self.rect = rect
        self.api = api
        self.user_data_dir = user_data_dir
        self.on_ready = on_ready
        self.on_closed = on_closed
        self.hwnd = None
        self._controller = None
        self._dcomp = None
        self._invoker = None  # WinForms control living on our UI thread
        self._down = False
        self._created = threading.Event()

    # ------------------------------------------------------------ public

    def start(self, timeout=10.0):
        _load_assemblies()
        from System.Threading import ApartmentState, Thread, ThreadStart

        thread = Thread(ThreadStart(self._run))
        thread.SetApartmentState(ApartmentState.STA)
        thread.IsBackground = True
        thread.Start()
        self._created.wait(timeout)
        return self.hwnd is not None

    def load_url(self, url):
        self._ui(lambda: self._controller and self._controller.CoreWebView2.Navigate(url))

    def destroy(self):
        if self.hwnd:
            user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)

    # ------------------------------------------------------------ UI thread

    def _ui(self, fn):
        invoker = self._invoker
        if invoker is None or invoker.IsDisposed:
            return
        try:
            from System import Action

            invoker.BeginInvoke(Action(fn))
        except Exception:
            pass

    @classmethod
    def _register_class(cls):
        if cls._wndproc is not None:
            return
        cls._wndproc = WNDPROC(cls._dispatch)
        wc = _WNDCLASSEXW()
        wc.cbSize = ctypes.sizeof(_WNDCLASSEXW)
        wc.lpfnWndProc = cls._wndproc
        wc.hInstance = ctypes.windll.kernel32.GetModuleHandleW(None)
        wc.hCursor = user32.LoadCursorW(None, 32512)  # IDC_ARROW
        wc.lpszClassName = CLASS_NAME
        user32.RegisterClassExW(ctypes.byref(wc))

    @classmethod
    def _dispatch(cls, hwnd, msg, wparam, lparam):
        win = cls._instances.get(hwnd)
        if win is not None:
            handled = win._wndproc_msg(msg, wparam, lparam)
            if handled is not None:
                return handled
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _wndproc_msg(self, msg, wparam, lparam):
        if msg == WM_MOUSEACTIVATE:
            return MA_NOACTIVATE  # never steal the focus
        if msg in (WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP):
            self._forward_mouse(msg, wparam, lparam)
            return 0
        if msg == WM_DESTROY:
            self._teardown()
            return 0
        return None

    def _forward_mouse(self, msg, wparam, lparam):
        ctrl = self._controller
        if ctrl is None:
            return
        from System.Drawing import Point
        from Microsoft.Web.WebView2.Core import CoreWebView2MouseEventKind as Kind
        from Microsoft.Web.WebView2.Core import CoreWebView2MouseEventVirtualKeys as Keys

        x = ctypes.c_short(lparam & 0xFFFF).value
        y = ctypes.c_short((lparam >> 16) & 0xFFFF).value
        kind = {
            WM_MOUSEMOVE: Kind.Move,
            WM_LBUTTONDOWN: Kind.LeftButtonDown,
            WM_LBUTTONUP: Kind.LeftButtonUp,
            WM_RBUTTONDOWN: Kind.RightButtonDown,
            WM_RBUTTONUP: Kind.RightButtonUp,
        }[msg]
        if msg == WM_LBUTTONDOWN:
            # Keep the moves and the release coming while Hubi is dragged
            # (the window moves under the cursor).
            user32.SetCapture(self.hwnd)
            self._down = True
        elif msg == WM_LBUTTONUP:
            user32.ReleaseCapture()
            self._down = False
        keys = Keys.LeftButton if wparam & 0x0001 else Keys(0)
        try:
            ctrl.SendMouseInput(kind, keys, 0, Point(x, y))
        except Exception:
            pass

    def _run(self):
        import System
        import System.Windows.Forms as WF

        try:
            self._register_class()
            x, y, w, h = self.rect
            self.hwnd = user32.CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_NOREDIRECTIONBITMAP,
                CLASS_NAME, "Hubi", WS_POPUP, int(x), int(y), int(w), int(h),
                None, None, ctypes.windll.kernel32.GetModuleHandleW(None), None,
            )
            if not self.hwnd:
                return
            CompositionWindow._instances[self.hwnd] = self
            self._invoker = WF.Control()
            self._invoker.CreateControl()
            _ = self._invoker.Handle  # bind it to this thread
            self._dcomp = _DComp(self.hwnd)
        except Exception:
            self.hwnd = None
            return
        finally:
            self._created.set()

        self._create_webview()
        WF.Application.Run()

    def _create_webview(self):
        import System
        import System.Windows.Forms as WF
        from System import IntPtr
        from Microsoft.Web.WebView2.Core import CoreWebView2Environment

        # Read when the WebView2 browser process starts: transparent default
        # background (the page's own transparent pixels then show through).
        os.environ["WEBVIEW2_DEFAULT_BACKGROUND_COLOR"] = "0"
        env_task = CoreWebView2Environment.CreateAsync(None, self.user_data_dir, None)
        state = {}
        timer = WF.Timer()
        timer.Interval = 25

        def tick(sender, args):
            try:
                if "env" not in state:
                    if not env_task.IsCompleted:
                        return
                    if env_task.IsFaulted:
                        timer.Stop()
                        return
                    state["env"] = env_task.Result
                    state["task"] = state["env"].CreateCoreWebView2CompositionControllerAsync(IntPtr(self.hwnd))
                    return
                task = state["task"]
                if not task.IsCompleted:
                    return
                timer.Stop()
                if task.IsFaulted:
                    return
                self._attach(task.Result)
            except Exception:
                timer.Stop()

        timer.Tick += System.EventHandler(tick)
        timer.Start()
        self._timer = timer  # keep a reference

    def _attach(self, ctrl):
        from System import IntPtr
        from System.Drawing import Color, Rectangle
        from System.Runtime.InteropServices import Marshal

        self._controller = ctrl
        ctrl.DefaultBackgroundColor = Color.Transparent
        ctrl.Bounds = Rectangle(0, 0, int(self.rect[2]), int(self.rect[3]))
        ctrl.IsVisible = True
        ctrl.RootVisualTarget = Marshal.GetObjectForIUnknown(IntPtr(self._dcomp.visual.value))
        self._dcomp.commit()
        core = ctrl.CoreWebView2
        core.Settings.AreDefaultContextMenusEnabled = False
        core.Settings.IsZoomControlEnabled = False
        core.AddScriptToExecuteOnDocumentCreatedAsync(_BRIDGE_JS)
        core.WebMessageReceived += self._on_message
        core.Navigate(self.url)
        user32.ShowWindow(self.hwnd, SW_SHOWNOACTIVATE)
        if self.on_ready:
            threading.Thread(target=self.on_ready, daemon=True).start()

    def resize(self, w, h):
        """Keep WebView2's bounds in step with the window size."""

        def _apply():
            from System.Drawing import Rectangle

            if self._controller is not None:
                self._controller.Bounds = Rectangle(0, 0, int(w), int(h))

        self.rect = (self.rect[0], self.rect[1], w, h)
        self._ui(_apply)

    def _on_message(self, sender, args):
        try:
            message = json.loads(args.TryGetWebMessageAsString())
        except Exception:
            return
        threading.Thread(target=self._call_api, args=(message,), daemon=True).start()

    def _call_api(self, message):
        mid, name, call_args = message.get("id"), message.get("name"), message.get("args") or []
        reply = {"id": mid}
        method = getattr(self.api, name, None) if isinstance(name, str) and not name.startswith("_") else None
        if not callable(method):
            reply["error"] = f"unknown method {name}"
        else:
            try:
                reply["result"] = method(*call_args)
            except Exception as e:  # noqa: BLE001
                reply["error"] = str(e)
        text = json.dumps(reply, default=str)
        self._ui(lambda: self._controller and self._controller.CoreWebView2.PostWebMessageAsString(text))

    def _teardown(self):
        import System.Windows.Forms as WF

        CompositionWindow._instances.pop(self.hwnd, None)
        try:
            if self._controller is not None:
                self._controller.Close()
        except Exception:
            pass
        self._controller = None
        if self._dcomp is not None:
            self._dcomp.release()
            self._dcomp = None
        self.hwnd = None
        WF.Application.ExitThread()
        if self.on_closed:
            threading.Thread(target=self.on_closed, daemon=True).start()

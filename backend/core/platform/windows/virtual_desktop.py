"""Keep a window on whichever virtual desktop is showing (Win+Ctrl+arrows).

A Windows window lives on one virtual desktop only. Uses the documented
IVirtualDesktopManager (Windows 10+): a background thread checks a few times
a second whether the window is on the current desktop, and if not moves it
there — the target desktop is read from the foreground window. A window can
only be moved by its own process, which is the case for Hubi.

Called through raw ctypes (vtable) to avoid a comtypes dependency. Without
virtual desktops (Windows Server, older builds) it silently does nothing.
"""
import ctypes
import threading
from ctypes import wintypes

CHECK_EVERY = 0.35  # s


class GUID(ctypes.Structure):
    _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD), ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]


def _guid(text):
    g = GUID()
    ctypes.oledll.ole32.CLSIDFromString(ctypes.c_wchar_p(text), ctypes.byref(g))
    return g


CLSID_VirtualDesktopManager = "{AA509086-5CA9-4C25-8F95-589D3C07B48A}"
IID_IVirtualDesktopManager = "{A5CD92FF-29BE-454C-8D04-D82879FB3F1B}"

# IUnknown (3) then IsWindowOnCurrentVirtualDesktop, GetWindowDesktopId, MoveWindowToDesktop.
_IS_ON_CURRENT, _GET_DESKTOP_ID, _MOVE_TO_DESKTOP, _RELEASE = 3, 4, 5, 2

_user32 = ctypes.windll.user32
_state = {"thread": None, "stop": None}


def _method(ptr, index, *argtypes):
    vtable = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    proto = ctypes.WINFUNCTYPE(ctypes.HRESULT, ctypes.c_void_p, *argtypes)
    return proto(vtable[index])


def _loop(hwnd, enabled, stop):
    ole32 = ctypes.oledll.ole32
    try:
        ole32.CoInitializeEx(None, 2)  # COINIT_APARTMENTTHREADED, on this thread
    except OSError:
        pass
    manager = ctypes.c_void_p()
    try:
        ole32.CoCreateInstance(
            ctypes.byref(_guid(CLSID_VirtualDesktopManager)),
            None,
            1 | 4,  # CLSCTX_INPROC_SERVER | CLSCTX_LOCAL_SERVER
            ctypes.byref(_guid(IID_IVirtualDesktopManager)),
            ctypes.byref(manager),
        )
    except OSError:
        return  # no virtual desktops on this system
    is_on_current = _method(manager, _IS_ON_CURRENT, wintypes.HWND, ctypes.POINTER(wintypes.BOOL))
    get_desktop_id = _method(manager, _GET_DESKTOP_ID, wintypes.HWND, ctypes.POINTER(GUID))
    move_to_desktop = _method(manager, _MOVE_TO_DESKTOP, wintypes.HWND, ctypes.POINTER(GUID))
    try:
        while not stop.wait(CHECK_EVERY):
            if not _user32.IsWindow(hwnd):
                break
            if not enabled():
                continue
            try:
                on = wintypes.BOOL()
                is_on_current(manager, hwnd, ctypes.byref(on))
                if on.value:
                    continue
                fg = _user32.GetForegroundWindow()
                if not fg or fg == hwnd:
                    continue
                desktop = GUID()
                # Shell windows (taskbar, desktop) belong to no desktop: the
                # call fails or returns GUID_NULL — just wait for a real one.
                get_desktop_id(manager, fg, ctypes.byref(desktop))
                if desktop.Data1 == 0 and desktop.Data2 == 0 and desktop.Data3 == 0 and not any(desktop.Data4):
                    continue
                move_to_desktop(manager, hwnd, ctypes.byref(desktop))
            except OSError:
                continue
    finally:
        try:
            _method(manager, _RELEASE)(manager)
        except Exception:
            pass
        try:
            ole32.CoUninitialize()
        except OSError:
            pass


def follow(hwnd, enabled):
    """Start keeping `hwnd` on the current virtual desktop while `enabled()`."""
    stop_following()
    stop = threading.Event()
    thread = threading.Thread(target=_loop, args=(int(hwnd), enabled, stop), daemon=True)
    _state["thread"], _state["stop"] = thread, stop
    thread.start()


def stop_following():
    if _state["stop"] is not None:
        _state["stop"].set()
    _state["thread"] = _state["stop"] = None

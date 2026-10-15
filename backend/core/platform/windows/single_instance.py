"""One Dev Hub at a time: a second launch brings the running one to the front.

A named mutex says whether Dev Hub already runs (it disappears with the
process, even after a crash or a force-kill — unlike a lock file). The first
instance also writes its pid, so the second can find its window.
"""
import ctypes
import os
from ctypes import wintypes

from app_config import APP_DATA_DIR

MUTEX_NAME = "Local\\SalifBiaye.DevHub.Main"
PID_FILE = APP_DATA_DIR / "devhub.pid"
ERROR_ALREADY_EXISTS = 183
SW_RESTORE = 9

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)  # keeps GetLastError reliable
user32 = ctypes.windll.user32
kernel32.CreateMutexW.restype = wintypes.HANDLE
kernel32.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]

_mutex = {"handle": None}  # kept for the whole life of the process


def claim():
    """True if this is the only Dev Hub; False if another one already runs."""
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if not handle:
        return True  # can't tell: better two windows than none
    if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
        kernel32.CloseHandle(handle)
        return False
    _mutex["handle"] = handle
    try:
        PID_FILE.write_text(str(os.getpid()))
    except OSError:
        pass
    return True


def _main_window_of(pid):
    found = []
    enum_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def callback(hwnd, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value != pid or not user32.IsWindowVisible(hwnd):
            return True
        title = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, title, 256)
        if title.value == "Dev Hub":
            found.append(hwnd)
            return False
        return True

    user32.EnumWindows(enum_proc(callback), 0)
    return found[0] if found else None


def focus_running():
    """Bring the running Dev Hub's window to the front. True if found."""
    try:
        pid = int(PID_FILE.read_text().strip())
    except (OSError, ValueError):
        return False
    hwnd = _main_window_of(pid)
    if not hwnd:
        return False
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)
    # A freshly launched process may hand the foreground over (it was just
    # started by the user), so this is allowed here.
    user32.SetForegroundWindow(hwnd)
    return True

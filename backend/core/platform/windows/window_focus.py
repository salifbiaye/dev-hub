import ctypes
import subprocess

import win32con
import win32gui
import win32process


def is_process_running(exe_name):
    try:
        result = subprocess.run(
            ["tasklist", "/NH", "/FI", f"IMAGENAME eq {exe_name}"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return exe_name.lower() in result.stdout.lower()
    except Exception:
        return False


def get_pids_for_exe(exe_name):
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {exe_name}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        pids = []
        for line in result.stdout.strip().splitlines():
            parts = [p.strip('"') for p in line.split('","')]
            if len(parts) >= 2:
                try:
                    pids.append(int(parts[1]))
                except ValueError:
                    pass
        return pids
    except Exception:
        return []


def is_hung_window(hwnd):
    # pywin32's win32gui doesn't wrap IsHungAppWindow despite it being a
    # plain user32 export — go straight through ctypes instead. This used
    # to raise AttributeError on every "open a 2nd project in the same
    # running IDE" click, which pywebview's bridge didn't always turn into
    # a clean promise rejection, leaving the "Ouvrir" button spinning
    # forever with no error shown.
    return bool(ctypes.windll.user32.IsHungAppWindow(hwnd))


def find_any_window(exe_name):
    pids = set(get_pids_for_exe(exe_name))
    if not pids:
        return None
    target = None

    def callback(hwnd, _):
        nonlocal target
        if not win32gui.IsWindowVisible(hwnd) or not win32gui.GetWindowText(hwnd):
            return True
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        if pid in pids:
            target = hwnd
            return False
        return True

    try:
        win32gui.EnumWindows(callback, None)
    except Exception:
        pass
    return target


def bring_to_front(exe_name, title_hint=None, require_title_match=False):
    # OpenProcess-based name lookup can silently fail to access JetBrains IDE
    # processes; tasklist already reliably finds them (used by
    # is_process_running), so reuse it for the PIDs and just match windows
    # by owning PID — GetWindowThreadProcessId needs no special access.
    pids = set(get_pids_for_exe(exe_name))
    if not pids:
        return False

    target_hwnd = None
    fallback_hwnd = None
    hint = (title_hint or "").lower()

    def callback(hwnd, _):
        nonlocal target_hwnd, fallback_hwnd
        if not win32gui.IsWindowVisible(hwnd) or not win32gui.GetWindowText(hwnd):
            return True
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        if pid in pids:
            title = win32gui.GetWindowText(hwnd)
            if hint and hint in title.lower():
                target_hwnd = hwnd
                return False
            if fallback_hwnd is None:
                fallback_hwnd = hwnd
        return True

    try:
        win32gui.EnumWindows(callback, None)
    except Exception:
        pass

    if not target_hwnd and require_title_match:
        return False
    target_hwnd = target_hwnd or fallback_hwnd
    if not target_hwnd:
        return False

    try:
        if win32gui.IsIconic(target_hwnd):
            win32gui.ShowWindow(target_hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(target_hwnd)
        return True
    except Exception:
        pass

    # Windows blocks SetForegroundWindow from background processes unless the
    # caller's thread is attached to the target's input queue — this trick
    # bypasses that restriction.
    try:
        fg_hwnd = win32gui.GetForegroundWindow()
        fg_thread = win32process.GetWindowThreadProcessId(fg_hwnd)[0]
        target_thread = win32process.GetWindowThreadProcessId(target_hwnd)[0]
        win32process.AttachThreadInput(fg_thread, target_thread, True)
        try:
            win32gui.SetForegroundWindow(target_hwnd)
        finally:
            win32process.AttachThreadInput(fg_thread, target_thread, False)
        return True
    except Exception:
        return False

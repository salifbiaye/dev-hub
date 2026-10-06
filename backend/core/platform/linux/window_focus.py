import shutil
import subprocess

import psutil

# wmctrl is the only thing used for window-level operations here (there is
# no psutil equivalent for "find/activate a window") -- logged once if
# missing instead of spamming on every call, and every function below
# degrades to a safe False/None rather than raising.
_warned_no_wmctrl = False


def _warn_no_wmctrl_once():
    global _warned_no_wmctrl
    if not _warned_no_wmctrl:
        _warned_no_wmctrl = True
        print("[devhub] wmctrl introuvable -- bring_to_front()/find_any_window() seront no-op (installe wmctrl pour ce support)")


def is_process_running(exe_name):
    name = exe_name.lower()
    try:
        for proc in psutil.process_iter(["name"]):
            if (proc.info.get("name") or "").lower() == name:
                return True
    except Exception:
        pass
    return False


def get_pids_for_exe(exe_name):
    name = exe_name.lower()
    pids = []
    try:
        for proc in psutil.process_iter(["pid", "name"]):
            if (proc.info.get("name") or "").lower() == name:
                pids.append(proc.info["pid"])
    except Exception:
        pass
    return pids


def _wmctrl_list():
    # Each line: "<window id> <desktop> <pid> <client machine> <title...>"
    result = subprocess.run(["wmctrl", "-lp"], capture_output=True, text=True, timeout=5)
    windows = []
    for line in result.stdout.splitlines():
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        win_id, _desktop, pid_str, _machine, title = parts
        try:
            pid = int(pid_str)
        except ValueError:
            continue
        windows.append({"id": win_id, "pid": pid, "title": title})
    return windows


def find_any_window(exe_name):
    if not shutil.which("wmctrl"):
        _warn_no_wmctrl_once()
        return None
    pids = set(get_pids_for_exe(exe_name))
    if not pids:
        return None
    try:
        for win in _wmctrl_list():
            if win["pid"] in pids:
                return win["id"]
    except Exception:
        pass
    return None


def bring_to_front(exe_name, title_hint=None, require_title_match=False):
    if not shutil.which("wmctrl"):
        _warn_no_wmctrl_once()
        return False
    pids = set(get_pids_for_exe(exe_name))
    if not pids:
        return False

    hint = (title_hint or "").lower()
    target = None
    fallback = None
    try:
        for win in _wmctrl_list():
            if win["pid"] not in pids:
                continue
            if hint and hint in win["title"].lower():
                target = win
                break
            if fallback is None:
                fallback = win
    except Exception:
        return False

    if not target and require_title_match:
        return False
    target = target or fallback
    if not target:
        return False

    try:
        subprocess.run(["wmctrl", "-ia", target["id"]], capture_output=True, timeout=5)
        return True
    except Exception:
        return False


def is_hung_window(hwnd):
    # No simple/reliable Linux/X11 equivalent is exposed without pulling in
    # a lot more machinery -- never report a window as hung on Linux. The
    # one caller (features/ide/detection.py's hung-IDE-kill flow) simply
    # never triggers that specific path here, an acceptable v1 limitation.
    return False

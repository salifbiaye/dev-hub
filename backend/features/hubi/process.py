"""Hubi as its own process: `DevHub.exe --hubi` (or `python main.py --hubi`).

Same executable as Dev Hub — whoever has DevHub.exe has Hubi — but a separate
process, so it lives on without Dev Hub's window (desktop shortcut, start with
Windows) and its WebView2 never initializes alongside Dev Hub's own (doing
both in one process left both windows rendering black).
"""
import os
import subprocess
import sys
from pathlib import Path

import psutil

from app_config import APP_DATA_DIR

PID_FILE = APP_DATA_DIR / "hubi.pid"
AUTOSTART_VALUE = "DevHubHubi"
_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def command():
    if getattr(sys, "frozen", False):
        return [sys.executable, "--hubi"]
    return [sys.executable, str(Path(__file__).resolve().parents[2] / "main.py"), "--hubi"]


def _read_pid():
    try:
        return int(PID_FILE.read_text().strip())
    except Exception:
        return None


def running_pid():
    pid = _read_pid()
    if not pid or pid == os.getpid():
        return None
    try:
        proc = psutil.Process(pid)
        if proc.is_running() and "--hubi" in proc.cmdline():
            return pid
    except Exception:
        pass
    return None


def is_running():
    return running_pid() is not None


def claim_instance():
    """Called by the Hubi process itself. False if another Hubi is already up."""
    if running_pid():
        return False
    PID_FILE.write_text(str(os.getpid()))
    return True


def release_instance():
    if _read_pid() == os.getpid():
        try:
            PID_FILE.unlink()
        except Exception:
            pass


def launch():
    if is_running():
        return True
    kwargs = {"close_fds": True}
    if sys.platform == "win32":
        # Detached: closing Dev Hub must not take Hubi down with it.
        kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    try:
        subprocess.Popen(command(), **kwargs)
        return True
    except Exception:
        return False


def stop():
    pid = running_pid()
    if not pid:
        return
    try:
        proc = psutil.Process(pid)
        for child in proc.children(recursive=True):
            child.kill()
        proc.kill()
    except Exception:
        pass
    try:
        PID_FILE.unlink()
    except Exception:
        pass


def _quoted_command():
    return subprocess.list2cmdline(command())


def autostart_enabled():
    if sys.platform != "win32":
        return False
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
            winreg.QueryValueEx(key, AUTOSTART_VALUE)
            return True
    except Exception:
        return False


def set_autostart(enabled):
    if sys.platform != "win32":
        return {"error": "Démarrage automatique disponible sur Windows uniquement"}
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                winreg.SetValueEx(key, AUTOSTART_VALUE, 0, winreg.REG_SZ, _quoted_command())
            else:
                try:
                    winreg.DeleteValue(key, AUTOSTART_VALUE)
                except FileNotFoundError:
                    pass
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}


def _desktop_dir():
    # The real Desktop folder, OneDrive-redirected or not.
    import ctypes
    from ctypes import wintypes

    buf = ctypes.create_unicode_buffer(wintypes.MAX_PATH)
    ctypes.windll.shell32.SHGetFolderPathW(None, 0x10, None, 0, buf)  # CSIDL_DESKTOPDIRECTORY
    return Path(buf.value)


def _shortcut_path():
    return _desktop_dir() / "Hubi.lnk"


def shortcut_exists():
    if sys.platform != "win32":
        return False
    try:
        return _shortcut_path().exists()
    except Exception:
        return False


def _hubi_icon_path():
    # Hubi's own mascot (same artwork as its tray icon), not Dev Hub's logo.
    from .tray import _make_image

    # New name per artwork: Explorer caches icons by path.
    path = APP_DATA_DIR / "hubi-mascot.ico"
    _make_image("normal", 256).save(
        path, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    return path


_shortcut_refreshed = False


def refresh_shortcut_once():
    """A shortcut made by an older build points at Dev Hub's icon; rewrite it
    (once per Dev Hub run) so it shows Hubi's eyes."""
    global _shortcut_refreshed
    if _shortcut_refreshed or not shortcut_exists():
        return
    _shortcut_refreshed = True
    create_desktop_shortcut()


def remove_desktop_shortcut():
    try:
        _shortcut_path().unlink()
    except FileNotFoundError:
        pass
    except Exception as e:
        return {"error": str(e)}
    return {"ok": True}


def create_desktop_shortcut():
    if sys.platform != "win32":
        return {"error": "Raccourci disponible sur Windows uniquement"}
    cmd = command()
    target, args = cmd[0], subprocess.list2cmdline(cmd[1:])
    try:
        icon = _hubi_icon_path()
    except Exception:
        icon = f"{target},0"
    script = (
        "$s = New-Object -ComObject WScript.Shell;"
        f"$l = $s.CreateShortcut('{_shortcut_path()}');"
        f"$l.TargetPath = '{target}';"
        f"$l.Arguments = '{args}';"
        f"$l.IconLocation = '{icon}';"
        "$l.Description = 'Hubi, le compagnon de Dev Hub';"
        "$l.Save()"
    )
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True,
            text=True,
            timeout=20,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if out.returncode != 0:
            return {"error": (out.stderr or out.stdout or "Échec").strip()}
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}

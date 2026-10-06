import os
import shutil
import subprocess
from pathlib import Path

from .. import base
from . import clipboard as _clipboard
from . import dpi as _dpi
from . import hotkeys as _hotkeys
from . import icon as _icon
from . import process_control as _process_control
from . import pty as _pty
from . import window_focus as _window_focus


class WindowsPlatform(base.PlatformService):
    # -- clipboard ---------------------------------------------------
    def clipboard_copy(self, text):
        return _clipboard.clipboard_copy(text)

    # -- PTY / terminal ------------------------------------------------
    def spawn_pty(self, argv, cwd, env, rows=24, cols=80):
        return _pty.spawn_pty(argv, cwd, env, rows, cols)

    def _git_bash_launcher(self):
        # `bash.exe` resolves via PATH (usr/bin/bash.exe) but launching it
        # directly in a plain Windows console comes up broken/garbled — MSYS
        # needs the real git-bash.exe launcher, which sets up its console
        # properly and isn't normally on PATH itself. It lives one level up
        # from wherever git.exe's bin/cmd folder is.
        git = shutil.which("git")
        if git:
            for parent in Path(git).resolve().parents:
                candidate = parent / "git-bash.exe"
                if candidate.exists():
                    return str(candidate)
        for candidate in (r"C:\Program Files\Git\git-bash.exe", r"C:\Program Files (x86)\Git\git-bash.exe"):
            if Path(candidate).exists():
                return candidate
        return None

    def list_terminal_kinds(self):
        # cmd and PowerShell ship with every Windows install; Git Bash only
        # exists if Git for Windows is installed.
        terminals = ["cmd", "powershell"]
        if self._git_bash_launcher():
            terminals.append("bash")
        return terminals

    def open_terminal_window(self, path, kind="cmd"):
        if not Path(path).is_dir():
            return {"error": "Dossier introuvable"}
        try:
            if kind == "powershell":
                subprocess.Popen(["powershell.exe", "-NoExit"], cwd=path, creationflags=subprocess.CREATE_NEW_CONSOLE)
            elif kind == "bash":
                git_bash = self._git_bash_launcher()
                if not git_bash:
                    return {"error": "Git Bash introuvable"}
                subprocess.Popen([git_bash], cwd=path, creationflags=subprocess.CREATE_NEW_CONSOLE)
            else:
                subprocess.Popen(["cmd.exe"], cwd=path, creationflags=subprocess.CREATE_NEW_CONSOLE)
        except Exception as e:
            return {"error": str(e)}
        return {"ok": True}

    # -- window focus / hung-window detection ---------------------------
    def is_process_running(self, exe_name):
        return _window_focus.is_process_running(exe_name)

    def get_pids_for_exe(self, exe_name):
        return _window_focus.get_pids_for_exe(exe_name)

    def find_any_window(self, exe_name):
        return _window_focus.find_any_window(exe_name)

    def bring_to_front(self, exe_name, title_hint=None, require_title_match=False):
        return _window_focus.bring_to_front(exe_name, title_hint, require_title_match)

    def is_hung_window(self, hwnd):
        return _window_focus.is_hung_window(hwnd)

    # -- process control -------------------------------------------------
    def kill_process_tree(self, pid):
        return _process_control.kill_process_tree(pid)

    def terminate_by_name(self, exe_name, force=False):
        return _process_control.terminate_by_name(exe_name, force)

    def orphan_processes(self, repo_paths, tracked_pids):
        return _process_control.orphan_processes(repo_paths, tracked_pids)

    # -- config / app data dir -------------------------------------------
    def config_dir(self):
        d = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "DevHub"
        d.mkdir(parents=True, exist_ok=True)
        return d

    # -- window chrome -----------------------------------------------------
    def apply_window_icon(self, win, ico_path):
        return _icon.apply_window_icon(win, ico_path)

    def start_fullscreen_hotkey_watch(self, get_main_window, get_browser_window, set_fullscreen, is_fullscreen):
        return _hotkeys.start_fullscreen_hotkey_watch(get_main_window, get_browser_window, set_fullscreen, is_fullscreen)

    def is_window_fullscreen(self, win):
        return _hotkeys.is_window_fullscreen(win)

    def get_dpi_scale(self, win_form):
        return _dpi.get_dpi_scale(win_form)

    # -- misc --------------------------------------------------------------
    def shell_options(self):
        return [
            {"value": "cmd", "label": "cmd"},
            {"value": "powershell", "label": "PowerShell"},
        ]

    def ide_dirs(self):
        return {"jetbrains_root": Path(os.environ.get("LOCALAPPDATA", "")) / "JetBrains"}


__all__ = ["WindowsPlatform"]

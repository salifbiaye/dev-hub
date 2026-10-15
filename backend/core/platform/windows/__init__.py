import os
import shutil
import subprocess
from pathlib import Path

from .. import base
from . import clipboard as _clipboard
from . import dpi as _dpi
from . import global_hotkey as _global_hotkey
from . import hotkeys as _hotkeys
from . import icon as _icon
from . import overlay as _overlay
from . import process_control as _process_control
from . import pty as _pty
from . import snap as _snap
from . import window_drag as _window_drag
from . import window_focus as _window_focus


class WindowsPlatform(base.PlatformService):
    def start_native_drag(self, win):
        return _window_drag.start_native_drag(win)

    def start_global_hotkey(self, combo, callback):
        return _global_hotkey.start(combo, callback)

    def enable_native_frame(self, win):
        return _snap.enable_native_frame(win)

    def is_window_maximized(self, win):
        return _snap.is_maximized(win)

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

    # -- floating overlay window (Hubi) --------------------------------------
    def overlay_prepare(self, win):
        return _overlay.prepare(win)

    def round_window_corners(self, win, border_rgb=None):
        return _overlay.round_corners(win, border_rgb)

    def force_foreground(self, win):
        return _overlay.force_foreground(win)

    def show_dim_overlay(self, owner_win, on_click=None):
        from . import dim_overlay

        return dim_overlay.show(owner_win, on_click)

    def hide_dim_overlay(self):
        from . import dim_overlay

        return dim_overlay.hide()

    def overlay_rect(self, win):
        return _overlay.rect(win)

    def overlay_set_rect(self, win, x=None, y=None, w=None, h=None):
        return _overlay.set_rect(win, x, y, w, h)

    def overlay_set_form_visible(self, win, visible):
        return _overlay.set_form_visible(win, visible)

    def overlay_set_visible(self, win, visible):
        return _overlay.set_visible(win, visible)

    def overlay_keep_on_top(self, win):
        return _overlay.keep_on_top(win)

    def overlay_dpi_scale(self, win):
        return _overlay.dpi_scale(win)

    def overlay_set_hit_region(self, win, rects):
        return _overlay.set_hit_region(win, rects)

    def create_transparent_window(self, url, rect, api, user_data_dir, on_ready=None, on_closed=None):
        from .composition_window import CompositionWindow

        win = CompositionWindow(url, rect, api, user_data_dir, on_ready, on_closed)
        return win if win.start() else None

    def claim_single_instance(self):
        from . import single_instance

        return single_instance.claim()

    def focus_running_instance(self):
        from . import single_instance

        return single_instance.focus_running()

    def overlay_follow_desktops(self, win, enabled):
        from . import virtual_desktop

        hwnd = _overlay._hwnd(win)
        if not hwnd:
            return False
        virtual_desktop.follow(hwnd, enabled)
        return True

    def overlay_screen(self):
        return _overlay.screen()

    def overlay_native_drag(self):
        return True

    def cursor_pos(self):
        return _overlay.cursor_pos()

    def left_button_down(self):
        return _overlay.left_button_down()

    def idle_seconds(self):
        return _overlay.idle_seconds()

    # -- misc --------------------------------------------------------------
    def shell_options(self):
        return [
            {"value": "cmd", "label": "cmd"},
            {"value": "powershell", "label": "PowerShell"},
        ]

    def ide_dirs(self):
        return {"jetbrains_root": Path(os.environ.get("LOCALAPPDATA", "")) / "JetBrains"}


__all__ = ["WindowsPlatform"]

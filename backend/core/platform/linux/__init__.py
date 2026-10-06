"""Linux platform implementation.

Mirrors core/platform/windows/__init__.py's role: assembles LinuxPlatform
from the small per-concern modules in this package. Features never import
these submodules directly -- they go through `platform_svc` instead.
"""
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

# value -> (label, cwd launch builder). gnome-terminal/konsole/xfce4-terminal
# all take a --working-directory=<path>-style flag; xterm has no such flag,
# so it's launched via Popen(cwd=path) instead (handled specially below).
_TERMINAL_EMULATORS = [
    ("gnome-terminal", "GNOME Terminal"),
    ("konsole", "Konsole"),
    ("xfce4-terminal", "Xfce Terminal"),
    ("xterm", "xterm"),
]

_SHELLS = [
    ("bash", "bash"),
    ("sh", "sh"),
    ("zsh", "zsh"),
]


class LinuxPlatform(base.PlatformService):
    # -- clipboard ---------------------------------------------------
    def clipboard_copy(self, text):
        return _clipboard.clipboard_copy(text)

    # -- PTY / terminal ------------------------------------------------
    def spawn_pty(self, argv, cwd, env, rows=24, cols=80):
        return _pty.spawn_pty(argv, cwd, env, rows, cols)

    def list_terminal_kinds(self):
        return [
            {"value": value, "label": label}
            for value, label in _TERMINAL_EMULATORS
            if shutil.which(value)
        ]

    def open_terminal_window(self, path, kind="cmd"):
        if not Path(path).is_dir():
            return {"error": "Dossier introuvable"}
        binary = kind if shutil.which(kind) else None
        if not binary:
            return {"error": f"Terminal introuvable : {kind}"}
        try:
            if binary == "gnome-terminal":
                subprocess.Popen(["gnome-terminal", f"--working-directory={path}"])
            elif binary == "konsole":
                subprocess.Popen(["konsole", "--workdir", path])
            elif binary == "xfce4-terminal":
                subprocess.Popen(["xfce4-terminal", f"--working-directory={path}"])
            elif binary == "xterm":
                subprocess.Popen(["xterm"], cwd=path)
            else:
                return {"error": f"Terminal non pris en charge : {kind}"}
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
        d = Path.home() / ".config" / "DevHub"
        d.mkdir(parents=True, exist_ok=True)
        return d

    # -- window chrome -----------------------------------------------------
    def apply_window_icon(self, win, ico_path):
        return _icon.apply_window_icon(win, ico_path)

    def start_fullscreen_hotkey_watch(self, get_main_window, get_browser_window, set_fullscreen, is_fullscreen):
        return _hotkeys.start_fullscreen_hotkey_watch(get_main_window, get_browser_window, set_fullscreen, is_fullscreen)

    def is_window_fullscreen(self, win):
        return _hotkeys.is_window_fullscreen(win)

    def get_dpi_scale(self, win):
        return _dpi.get_dpi_scale(win)

    # -- misc --------------------------------------------------------------
    def shell_options(self):
        options = [{"value": value, "label": label} for value, label in _SHELLS if shutil.which(value)]
        if not options:
            options = [{"value": "/bin/sh", "label": "sh"}]
        return options

    def ide_dirs(self):
        return {"jetbrains_root": Path.home() / ".config" / "JetBrains"}


__all__ = ["LinuxPlatform"]

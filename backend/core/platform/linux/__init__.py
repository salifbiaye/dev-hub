"""Linux platform implementation -- stubs only for this pass.

Dev Hub's Linux port is a later phase (see the plan's steps 5-7). These
stubs exist purely so `core/platform/__init__.py` can import and
instantiate a LinuxPlatform on `sys.platform != "win32"` without crashing;
every method raises NotImplementedError until the real port lands.
"""
from .. import base
from . import clipboard as _clipboard
from . import icon as _icon
from . import process_control as _process_control
from . import pty as _pty
from . import window_focus as _window_focus


class LinuxPlatform(base.PlatformService):
    def clipboard_copy(self, text):
        return _clipboard.clipboard_copy(text)

    def spawn_pty(self, argv, cwd, env, rows=24, cols=80):
        return _pty.spawn_pty(argv, cwd, env, rows, cols)

    def list_terminal_kinds(self):
        raise NotImplementedError("Linux support not yet implemented")

    def open_terminal_window(self, path, kind="cmd"):
        raise NotImplementedError("Linux support not yet implemented")

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

    def kill_process_tree(self, pid):
        return _process_control.kill_process_tree(pid)

    def terminate_by_name(self, exe_name, force=False):
        return _process_control.terminate_by_name(exe_name, force)

    def orphan_processes(self, repo_paths, tracked_pids):
        return _process_control.orphan_processes(repo_paths, tracked_pids)

    def config_dir(self):
        raise NotImplementedError("Linux support not yet implemented")

    def apply_window_icon(self, win, ico_path):
        return _icon.apply_window_icon(win, ico_path)

    def start_fullscreen_hotkey_watch(self, get_main_window, get_browser_window, set_fullscreen, is_fullscreen):
        raise NotImplementedError("Linux support not yet implemented")

    def is_window_fullscreen(self, win):
        raise NotImplementedError("Linux support not yet implemented")

    def get_dpi_scale(self, win_form):
        raise NotImplementedError("Linux support not yet implemented")

    def shell_options(self):
        raise NotImplementedError("Linux support not yet implemented")

    def ide_dirs(self):
        raise NotImplementedError("Linux support not yet implemented")


__all__ = ["LinuxPlatform"]

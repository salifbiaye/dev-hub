"""Common interface every OS-specific platform implementation must provide.

Behavior lives in core/platform/windows/* (today) and core/platform/linux/*
(stubs for now, real implementation in a later phase). Features never import
win32*/winpty/ctypes directly -- they go through `platform_svc` instead, so
the only place that knows which OS it's running on is this package.
"""
from abc import ABC, abstractmethod


class PlatformService(ABC):
    # -- clipboard ---------------------------------------------------
    @abstractmethod
    def clipboard_copy(self, text):
        """Copy `text` to the system clipboard. Returns {"ok": True} or
        {"ok": False, "error": str}."""

    # -- PTY / terminal ------------------------------------------------
    @abstractmethod
    def spawn_pty(self, argv, cwd, env, rows=24, cols=80):
        """Spawn a PTY running `argv`. Returns an object exposing
        .write(data), .read(n), .setwinsize(rows, cols), .close(force=True),
        .isalive(), .pid -- the same surface winpty.PtyProcess already has."""

    @abstractmethod
    def open_terminal_window(self, path, kind="cmd"):
        """Open a new, separate terminal window (cmd/powershell/bash on
        Windows) rooted at `path`. Returns {"ok": True} or {"error": str}."""

    @abstractmethod
    def list_terminal_kinds(self):
        """Terminal kinds available for open_terminal_window() on this OS."""

    # -- window focus / hung-window detection ---------------------------
    @abstractmethod
    def is_process_running(self, exe_name):
        ...

    @abstractmethod
    def get_pids_for_exe(self, exe_name):
        ...

    @abstractmethod
    def find_any_window(self, exe_name):
        ...

    @abstractmethod
    def bring_to_front(self, exe_name, title_hint=None, require_title_match=False):
        ...

    @abstractmethod
    def is_hung_window(self, hwnd):
        ...

    # -- process control -------------------------------------------------
    @abstractmethod
    def kill_process_tree(self, pid):
        ...

    @abstractmethod
    def terminate_by_name(self, exe_name, force=False):
        ...

    @abstractmethod
    def orphan_processes(self, repo_paths, tracked_pids):
        ...

    # -- config / app data dir -------------------------------------------
    @abstractmethod
    def config_dir(self):
        """Root directory for Dev Hub's own persisted data."""

    # -- window chrome -----------------------------------------------------
    @abstractmethod
    def apply_window_icon(self, win, ico_path):
        ...

    @abstractmethod
    def start_fullscreen_hotkey_watch(self, get_main_window, get_browser_window, set_fullscreen, is_fullscreen):
        ...

    @abstractmethod
    def is_window_fullscreen(self, win):
        ...

    @abstractmethod
    def get_dpi_scale(self, win):
        ...

    # -- misc --------------------------------------------------------------
    @abstractmethod
    def shell_options(self):
        """Run-config shell choices available on this OS, e.g.
        [{"value": "cmd", "label": "cmd"}, {"value": "powershell", "label": "PowerShell"}]."""

    @abstractmethod
    def ide_dirs(self):
        """OS-specific directories/roots used for IDE detection (e.g.
        %LOCALAPPDATA%/JetBrains on Windows)."""

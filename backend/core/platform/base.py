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

    # -- floating overlay window (Hubi) --------------------------------------
    # All coordinates here are *physical* pixels, so the same numbers can be
    # compared between the cursor, the window rect and the screen without any
    # per-call DPI juggling; overlay_dpi_scale() converts to/from CSS pixels.
    @abstractmethod
    def overlay_prepare(self, win):
        """One-time setup of a frameless, transparent, always-on-top widget
        window: keep it out of the taskbar/Alt-Tab, never let it take focus,
        and make its transparent areas truly click-through. Returns True on
        success."""

    @abstractmethod
    def overlay_rect(self, win):
        """(x, y, w, h) of the window in physical pixels, or None."""

    @abstractmethod
    def overlay_set_rect(self, win, x=None, y=None, w=None, h=None):
        """Move and/or resize the window (physical pixels). None = keep."""

    @abstractmethod
    def overlay_set_visible(self, win, visible):
        """Show (without stealing focus) or hide the window."""

    @abstractmethod
    def overlay_keep_on_top(self, win):
        """Re-assert the topmost z-order (full-screen apps can bury it)."""

    @abstractmethod
    def overlay_dpi_scale(self, win):
        """Physical pixels per CSS pixel for this window (1.0 = 96 dpi)."""

    @abstractmethod
    def overlay_screen(self):
        """{"primary": (w, h), "virtual": (x, y, w, h)} in physical pixels."""

    @abstractmethod
    def overlay_native_drag(self):
        """True when cursor_pos() and left_button_down() are reliable, so the
        widget can be dragged by Python without help from the page."""

    @abstractmethod
    def cursor_pos(self):
        """Global mouse position (x, y) in physical pixels, or None."""

    @abstractmethod
    def left_button_down(self):
        """Whether the left mouse button is currently held, or None."""

    @abstractmethod
    def idle_seconds(self):
        """Seconds since the last keyboard/mouse input anywhere, or None."""

    # -- misc --------------------------------------------------------------
    @abstractmethod
    def shell_options(self):
        """Run-config shell choices available on this OS, e.g.
        [{"value": "cmd", "label": "cmd"}, {"value": "powershell", "label": "PowerShell"}]."""

    @abstractmethod
    def ide_dirs(self):
        """OS-specific directories/roots used for IDE detection (e.g.
        %LOCALAPPDATA%/JetBrains on Windows)."""

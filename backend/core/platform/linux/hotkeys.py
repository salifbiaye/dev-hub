def start_fullscreen_hotkey_watch(get_main_window, get_browser_window, set_fullscreen, is_fullscreen):
    # Global F11/Escape hotkey capture via X11 requires XGrabKey plumbing
    # that's fragile and simply impossible under Wayland -- true no-op for
    # v1. The frontend's own in-page keydown listener already covers F11
    # while focus isn't inside the Processus preview iframe, an acceptable
    # v1 gap (same limitation noted in the plan).
    return


def is_window_fullscreen(win):
    # Best-effort GTK window-state query, wrapped defensively since this
    # cannot be verified from this Windows machine (no PyGObject available
    # here to confirm Gdk.WindowState.FULLSCREEN's exact bit / API shape in
    # the installed pywebview/PyGObject version).
    try:
        from webview.platforms.gtk import BrowserView
        from gi.repository import Gdk

        gtk_win = BrowserView.instances.get(win.uid)
        if not gtk_win:
            return False
        target = getattr(gtk_win, "window", gtk_win)
        gdk_window = target.get_window() if hasattr(target, "get_window") else None
        if gdk_window is None:
            return False
        state = gdk_window.get_state()
        return bool(state & Gdk.WindowState.FULLSCREEN)
    except Exception:
        return False

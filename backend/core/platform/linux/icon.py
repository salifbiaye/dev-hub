def apply_window_icon(win, ico_path):
    # Best-effort GTK equivalent of the Windows WinForms implementation
    # (core/platform/windows/icon.py): pywebview's GTK backend keeps its own
    # instance registry (BrowserView.instances) keyed by window uid, same
    # pattern as the WinForms backend.
    #
    # NOT independently verified: this machine is Windows-only, so
    # `webview.platforms.gtk` cannot be imported here (PyGObject isn't
    # installed) to confirm the exact attribute names/types. The exact
    # object returned by BrowserView.instances.get(win.uid) and whether it
    # exposes set_icon_from_file() directly (vs. needing `.window` or
    # similar) is inferred from pywebview's general architecture, not
    # confirmed against source. The broad except below means a wrong
    # attribute name just silently no-ops instead of crashing -- flagged in
    # the report as needing real-machine testing.
    try:
        from webview.platforms.gtk import BrowserView

        gtk_win = BrowserView.instances.get(win.uid)
        if not gtk_win:
            return False

        target = getattr(gtk_win, "window", gtk_win)
        if hasattr(target, "set_icon_from_file"):
            target.set_icon_from_file(str(ico_path))
            return True
        return False
    except Exception:
        return False

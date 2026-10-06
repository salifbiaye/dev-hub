def apply_window_icon(win, ico_path):
    # pywebview's Windows backend hosts the browser in a .NET WinForms Form,
    # reachable through its internal instance registry — the same object
    # pywebview itself sets `.Icon` on once at startup, so this just does
    # that again later with a different file.
    try:
        from webview.platforms.winforms import BrowserView
        from System import Func, Type
        from System.Drawing import Icon as NetIcon

        form = BrowserView.instances.get(win.uid)
        if not form:
            return False

        # WinForms controls can only be touched from the thread that created
        # them — this can run from a background thread, so the assignment
        # has to be marshaled onto the UI thread via Invoke, same as
        # pywebview's own minimize()/maximize()/close() do internally.
        def _set_icon():
            form.Icon = NetIcon(str(ico_path))

        form.Invoke(Func[Type](_set_icon))
        return True
    except Exception:
        return False

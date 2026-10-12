"""Best-effort GTK/X11 plumbing for Hubi's floating widget window.

NOT verified on a real Linux desktop (same caveat as the rest of this
package). Wayland forbids global cursor reads and client-side window
placement, so most of this only works under X11; every helper degrades to
"unavailable" (None/False) instead of raising, and the widget falls back to
page-driven dragging and never sleeps.
"""
import shutil
import subprocess


def _gtk_window(win):
    try:
        from webview.platforms.gtk import BrowserView

        inst = BrowserView.instances.get(win.uid)
        return getattr(inst, "window", inst)
    except Exception:
        return None


def _on_gtk_thread(fn):
    try:
        from gi.repository import GLib

        def _run():
            try:
                fn()
            except Exception:
                pass
            return False

        GLib.idle_add(_run)
        return True
    except Exception:
        return False


def prepare(win):
    gtk_win = _gtk_window(win)
    if gtk_win is None:
        return False

    def _setup():
        gtk_win.set_keep_above(True)
        gtk_win.set_skip_taskbar_hint(True)
        gtk_win.set_skip_pager_hint(True)
        gtk_win.set_accept_focus(False)

    return _on_gtk_thread(_setup)


def rect(win):
    try:
        return (int(win.x), int(win.y), int(win.width), int(win.height))
    except Exception:
        return None


def set_rect(win, x=None, y=None, w=None, h=None):
    try:
        if w is not None and h is not None:
            win.resize(int(w), int(h))
        if x is not None and y is not None:
            win.move(int(x), int(y))
        return True
    except Exception:
        return False


def set_visible(win, visible):
    try:
        if visible:
            win.show()
        else:
            win.hide()
        return True
    except Exception:
        return False


def keep_on_top(win):
    gtk_win = _gtk_window(win)
    if gtk_win is not None:
        _on_gtk_thread(lambda: gtk_win.set_keep_above(True))


def dpi_scale(win):
    return 1.0


def screen():
    try:
        from gi.repository import Gdk

        display = Gdk.Display.get_default()
        monitor = display.get_primary_monitor() or display.get_monitor(0)
        g = monitor.get_geometry()
        return {"primary": (g.width, g.height), "virtual": (g.x, g.y, g.width, g.height)}
    except Exception:
        return {"primary": (1920, 1080), "virtual": (0, 0, 1920, 1080)}


def cursor_pos():
    if shutil.which("xdotool"):
        try:
            out = subprocess.run(
                ["xdotool", "getmouselocation", "--shell"], capture_output=True, text=True, timeout=1
            ).stdout
            vals = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
            return (int(vals["X"]), int(vals["Y"]))
        except Exception:
            return None
    return None


def idle_seconds():
    if shutil.which("xprintidle"):
        try:
            out = subprocess.run(["xprintidle"], capture_output=True, text=True, timeout=1).stdout
            return int(out.strip()) / 1000.0
        except Exception:
            return None
    return None

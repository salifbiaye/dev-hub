"""Dev Hub's side of Hubi: lets the main UI read/toggle the widget."""
import webview

from . import tray, window


def quit_all():
    """Tray "Quitter": close every window, which ends webview.start()."""
    for w in list(webview.windows):
        try:
            w.destroy()
        except Exception:
            pass


def start():
    """Create the widget window and its tray icon."""
    window.create()
    tray.start(on_quit=quit_all)


def stop():
    tray.stop()
    window.destroy()


class HubiMixin:
    def hubi_get_state(self):
        return {
            "enabled": window.is_enabled(),
            "visible": window.is_visible(),
            "size": window.current_size(),
            "mood": window.current_mood(),
            "follow_theme": window.follows_theme(),
            "mascot": window.current_mascot(),
        }

    def hubi_set_enabled(self, enabled):
        window.set_enabled_flag(bool(enabled))
        if enabled:
            start()
        else:
            stop()
        return self.hubi_get_state()

    def hubi_test_mood(self, name):
        window.send_mood(name)
        return {"ok": True}

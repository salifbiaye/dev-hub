"""BrowserMixin -- for this pass, always dispatches to the Windows
implementation (features/browser/windows/*). A Linux implementation
(features/browser/linux/*, "one tab = one native pywebview window") is a
later phase per the plan; this module is where that dispatch will be added
once it exists."""
from .windows import window as browser_window


class BrowserMixin:
    def open_browser_tab(self, url=None, title=None):
        # url is optional — the "Navigateur" header button wants a blank
        # new tab, which new_tab() below already handles by falling back
        # to the start page. Callers that need a real URL (the Processus
        # "Ouvrir" buttons) already disable themselves via `disabled={!url}`
        # client-side.
        try:
            with browser_window._browser_window_lock:
                browser_window.ensure_browser_window()
            browser_window.get_browser_api().new_tab(url, title)
        except Exception as e:
            return {"error": f"Impossible d'ouvrir l'onglet : {e}"}
        return {"ok": True}

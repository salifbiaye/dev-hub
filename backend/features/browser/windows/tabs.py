import json
import threading
import urllib.parse
import urllib.request
import uuid

from core.platform import platform_svc

from .. import history
from . import window as browser_window


class _TabsMixin:
    """js_api for the standalone Navigateur window — see the module-level
    comment in window.py above _browser_window for why tab content lives as
    raw WebView2 controls instead of separate pywebview windows."""

    def __init__(self, win):
        self._win = win
        self._form = None
        self._tabs = {}  # tab_id -> {"control", "url", "title"}
        self._active_id = None
        self._content_rect = None
        self._maximized = False

    def _tab_payload_list(self):
        # CanGoBack/CanGoForward come from the live CoreWebView2 object —
        # read them all in one form.Invoke round trip rather than per-tab,
        # since this runs on every tab-list push (frequent: every nav,
        # title, and favicon change).
        from System import Func, Type

        can_go = {}
        form = self._get_form()

        def _read():
            for tid, t in self._tabs.items():
                control = t.get("control")
                try:
                    core = control.CoreWebView2 if control is not None else None
                    can_go[tid] = (bool(core.CanGoBack), bool(core.CanGoForward)) if core else (False, False)
                except Exception:
                    can_go[tid] = (False, False)

        if form is not None:
            form.Invoke(Func[Type](_read))
        else:
            _read()

        return [
            {
                "id": tid,
                "title": t["title"] or t["url"] or "Nouvel onglet",
                "url": t["url"],
                "favicon": t.get("favicon"),
                "device": t.get("device"),
                "device_label": t.get("device_label"),
                "device_w": t.get("device_w"),
                "device_h": t.get("device_h"),
                "device_ua": t.get("device_ua"),
                "canGoBack": can_go.get(tid, (False, False))[0],
                "canGoForward": can_go.get(tid, (False, False))[1],
            }
            for tid, t in self._tabs.items()
        ]

    def get_tabs(self):
        # Pulled once by browser.html on pywebviewready — the initial
        # new_tab() call happens immediately after create_window() returns,
        # which can race the chrome page's own load, so its first paint
        # can't rely solely on the push in _push_tabs().
        return {"tabs": self._tab_payload_list(), "active_id": self._active_id}

    def get_theme(self):
        # Mirrors whatever the main window's CSS currently resolves to,
        # rather than duplicating Dev Hub's ~30 theme palettes here —
        # automatically stays correct as themes are added/changed.
        return history.read_theme_vars()

    def search_history(self, query):
        # Backs the address bar's suggestion dropdown — reuses the same
        # history file top_frequent_sites reads for the new-tab cards,
        # just matched against the typed text instead of sorted by count.
        query = (query or "").strip().lower()
        if not query:
            return []
        data = history.load_browser_history()
        matches = [
            {"url": u, "title": v.get("title") or u, "favicon": v.get("favicon")}
            for u, v in data.items()
            if query in u.lower() or query in (v.get("title") or "").lower()
        ]
        matches.sort(key=lambda m: data[m["url"]].get("count", 0), reverse=True)
        return matches[:6]

    def search_suggestions(self, query):
        # Combines local history matches with live web search-completion
        # suggestions (like a real browser's address bar) -- history first
        # (instant, most relevant to this user), search completions after.
        query = (query or "").strip()
        if not query:
            return []
        hits = self.search_history(query)[:4]
        for m in hits:
            m["type"] = "history"

        completions = []
        try:
            url = "https://www.google.com/complete/search?" + urllib.parse.urlencode(
                {"client": "firefox", "q": query}
            )
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            for text in (data[1] if len(data) > 1 else [])[:5]:
                if text.lower() == query.lower():
                    continue
                completions.append({"type": "search", "text": text})
        except Exception:
            pass  # offline, blocked, slow, or malformed response -- history alone is still useful

        return hits + completions

    def push_theme_to_start_tabs(self, vars_json):
        # start.html tabs have no js_api bridge (only browser.html itself
        # does) — ExecuteScriptAsync lets Python push new CSS variables
        # directly into an already-loaded page without one.
        from System import Func, Type

        form = self._get_form()
        if form is None:
            return
        script = (
            "(function(){var v=" + vars_json + ";"
            "Object.keys(v).forEach(function(k){if(v[k])document.documentElement.style.setProperty('--'+k,v[k]);});})()"
        )
        for t in list(self._tabs.values()):
            control = t.get("control")
            if control is None or not history.is_start_page(t.get("url")):
                continue

            def _do(control=control):
                try:
                    control.CoreWebView2.ExecuteScriptAsync(script)
                except Exception:
                    pass

            form.Invoke(Func[Type](_do))

    def _scale(self):
        # rect coordinates come from browser.html's getBoundingClientRect(),
        # which is in logical/CSS pixels — but Control.Bounds on a
        # DPI-aware WinForms control expects physical pixels.
        form = self._get_form()
        return platform_svc.get_dpi_scale(form)

    def _scaled_rect(self, rect):
        from System.Drawing import Rectangle

        s = self._scale()
        return Rectangle(round(rect["x"] * s), round(rect["y"] * s), round(rect["width"] * s), round(rect["height"] * s))

    def _get_form(self):
        if self._form is None:
            from webview.platforms.winforms import BrowserView

            self._form = BrowserView.instances.get(self._win.uid)
        return self._form

    def _push_tabs(self):
        payload = self._tab_payload_list()
        try:
            self._win.evaluate_js(
                f"window.__browserOnTabsChanged && window.__browserOnTabsChanged({json.dumps(payload)}, {json.dumps(self._active_id)})"
            )
        except Exception:
            pass

    def _push_tabs_async(self):
        # Use from .NET event handlers (NavigationCompleted, DocumentTitleChanged)
        # — those fire synchronously on the GUI thread, and evaluate_js()
        # blocks waiting for a continuation delivered through that same
        # thread's message loop, which can't advance while it's the one
        # blocking. Running it off-thread avoids that self-deadlock (the
        # same one that was hit and fixed for the old per-tab window's
        # closing handler).
        threading.Thread(target=self._push_tabs, daemon=True).start()

    def _with_control(self, tab_id, fn):
        from System import Func, Type

        form = self._get_form()
        t = self._tabs.get(tab_id)
        if not form or not t or not t.get("control"):
            return

        def _do():
            try:
                fn(t["control"])
            except Exception:
                pass

        form.Invoke(Func[Type](_do))

    def new_tab(self, url=None, title=None):
        from System import Func, Type

        form = self._get_form()
        if form is None:
            return {"error": "Fenêtre navigateur indisponible"}

        tab_id = str(uuid.uuid4())
        target_url = history.normalize_url(url)
        if not target_url:
            target_url = history.start_page_url(browser_window.get_own_ui_base())
        else:
            history.record_visit(target_url, title)
        self._tabs[tab_id] = {
            "control": None,
            "url": target_url or "",
            "title": title or "",
            "favicon": None,
        }

        def _create():
            from Microsoft.Web.WebView2.WinForms import CoreWebView2CreationProperties, WebView2
            from System import Uri
            from System.Drawing import Color

            control = WebView2()
            props = CoreWebView2CreationProperties()
            props.UserDataFolder = str(browser_window.browser_profile_dir())
            from main import _PROXY_BYPASS_ARG

            props.AdditionalBrowserArguments = _PROXY_BYPASS_ARG
            control.CreationProperties = props
            # WebView2 paints white until the page's first frame arrives —
            # against Dev Hub's dark chrome that's a bright flash every
            # time a tab opens. Matches the window's own background_color.
            control.DefaultBackgroundColor = Color.FromArgb(255, 0x0A, 0x0A, 0x0C)
            rect = self._content_rect or {"x": 0, "y": 74, "width": 900, "height": 626}
            control.Bounds = self._scaled_rect(rect)

            def _on_nav_completed(sender, args):
                t = self._tabs.get(tab_id)
                if t is not None:
                    try:
                        t["url"] = str(control.Source)
                    except Exception:
                        pass
                self._push_tabs_async()

            def _on_core_ready(sender, args):
                try:
                    def _on_title_changed(s, a):
                        t = self._tabs.get(tab_id)
                        if t is not None:
                            try:
                                t["title"] = control.CoreWebView2.DocumentTitle
                            except Exception:
                                pass
                        self._push_tabs_async()

                    def _on_favicon_changed(s, a):
                        # FaviconUri is a plain URL (usually the site's own
                        # http(s) favicon URL) -- handing that straight to
                        # browser.html's <img src> lets its WebView2 fetch
                        # it independently instead of us shuttling bytes
                        # through GetFaviconAsync/JSON, which would need its
                        # own .NET Task continuation plumbing for little
                        # benefit here.
                        t = self._tabs.get(tab_id)
                        if t is not None:
                            try:
                                t["favicon"] = control.CoreWebView2.FaviconUri or None
                                history.record_visit(t["url"], favicon=t["favicon"], increment=False)
                            except Exception:
                                pass
                        self._push_tabs_async()

                    control.CoreWebView2.DocumentTitleChanged += _on_title_changed
                    control.CoreWebView2.FaviconChanged += _on_favicon_changed

                    # Off by default for WebView2 (unlike a normal Edge/
                    # Chrome profile) — without this a login form just
                    # submits with no "Enregistrer le mot de passe ?"
                    # prompt and no autofill dropdown on return visits.
                    settings = control.CoreWebView2.Settings
                    try:
                        settings.IsPasswordAutosaveEnabled = True
                    except Exception:
                        pass
                    try:
                        settings.IsGeneralAutofillEnabled = True
                    except Exception:
                        pass
                    try:
                        # The default WebView2 offline/connection-refused
                        # page carries visible "Microsoft Edge" branding —
                        # jarring inside a window meant to look like Dev
                        # Hub's own browser. Disabling it just leaves a
                        # blank page on a failed navigation instead.
                        settings.IsBuiltInErrorPageEnabled = False
                    except Exception:
                        pass
                    try:
                        # Captured once, before any device-emulation
                        # override — set_device_emulation()'s "Desktop"
                        # reset restores this exact string rather than
                        # trying to "unset" UserAgent (there's no distinct
                        # empty/default sentinel value for it).
                        t = self._tabs.get(tab_id)
                        if t is not None and "default_ua" not in t:
                            t["default_ua"] = settings.UserAgent
                    except Exception:
                        pass

                except Exception:
                    pass

            control.NavigationCompleted += _on_nav_completed
            control.CoreWebView2InitializationCompleted += _on_core_ready

            form.Controls.Add(control)
            for t in self._tabs.values():
                if t["control"] is not None:
                    t["control"].Visible = False
            control.Visible = True
            control.BringToFront()
            if target_url:
                control.Source = Uri(target_url)
            self._tabs[tab_id]["control"] = control

        form.Invoke(Func[Type](_create))
        self._active_id = tab_id
        self._push_tabs()
        return {"ok": True, "tab_id": tab_id}

    def switch_tab(self, tab_id):
        from System import Func, Type

        form = self._get_form()
        if form is None or tab_id not in self._tabs:
            return {"error": "Onglet introuvable"}

        def _do():
            for tid, t in self._tabs.items():
                if t["control"] is not None:
                    t["control"].Visible = tid == tab_id
            if self._tabs[tab_id]["control"] is not None:
                self._tabs[tab_id]["control"].BringToFront()

        form.Invoke(Func[Type](_do))
        self._active_id = tab_id
        self._push_tabs()
        return {"ok": True}

    def close_tab(self, tab_id):
        from System import Func, Type

        form = self._get_form()
        t = self._tabs.pop(tab_id, None)
        if t and form is not None and t.get("control") is not None:
            control = t["control"]

            def _do():
                try:
                    form.Controls.Remove(control)
                    control.Dispose()
                except Exception:
                    pass

            form.Invoke(Func[Type](_do))

        if self._active_id == tab_id:
            remaining = list(self._tabs.keys())
            self._active_id = remaining[-1] if remaining else None
            if self._active_id:
                self.switch_tab(self._active_id)
                return {"ok": True}

        if not self._tabs:
            try:
                self._win.hide()
            except Exception:
                pass

        self._push_tabs()
        return {"ok": True}

    def minimize_window(self):
        self._win.minimize()
        return {"ok": True}

    def toggle_maximize_window(self):
        if self._maximized:
            self._win.restore()
            self._maximized = False
        else:
            self._win.maximize()
            self._maximized = True
        return {"ok": True, "maximized": self._maximized}

    def close_window(self):
        self._win.destroy()
        return {"ok": True}

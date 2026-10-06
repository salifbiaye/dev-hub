from .. import history


class _NavigationMixin:
    def navigate(self, tab_id, url):
        from System import Uri

        target = history.normalize_url(url)
        if not target:
            return {"ok": True}
        self._with_control(tab_id, lambda c: setattr(c, "Source", Uri(target)))
        t = self._tabs.get(tab_id)
        if t is not None:
            t["url"] = target
        return {"ok": True}

    def go_back(self, tab_id):
        self._with_control(tab_id, lambda c: c.CoreWebView2 and c.CoreWebView2.GoBack())
        return {"ok": True}

    def go_forward(self, tab_id):
        self._with_control(tab_id, lambda c: c.CoreWebView2 and c.CoreWebView2.GoForward())
        return {"ok": True}

    def reload(self, tab_id):
        # start.html bakes the theme into its own query string at the
        # moment the tab opens (it has no js_api bridge to ask for a fresh
        # one itself) — a plain Reload() replays that same stale URL, so a
        # theme changed since then would revert on refresh. Re-navigating
        # to a freshly-built URL fixes that; every other page just reloads
        # as normal.
        from . import window as browser_window

        t = self._tabs.get(tab_id)
        if t is not None and history.is_start_page(t.get("url")):
            self.navigate(tab_id, history.start_page_url(browser_window.get_own_ui_base()))
        else:
            self._with_control(tab_id, lambda c: c.Reload())
        return {"ok": True}

    def report_content_rect(self, rect):
        from System import Func, Type

        self._content_rect = rect
        form = self._get_form()
        if form is None:
            return {"ok": True}

        def _do():
            for t in self._tabs.values():
                if t["control"] is not None:
                    t["control"].Bounds = self._scaled_rect(self._device_rect_for(t, rect))

        form.Invoke(Func[Type](_do))
        return {"ok": True}

    def _device_rect_for(self, t, rect):
        # Letterboxes a fixed-size device viewport centered within the
        # available content area (rather than filling it) -- clamped so a
        # device larger than the current window (e.g. iPad on a small
        # window) never overflows past the visible content area. Reads the
        # dimensions straight off the tab (set by set_device_emulation)
        # rather than re-deriving from DEVICE_PRESETS, since a custom
        # width/height isn't in that static dict at all.
        dw, dh = t.get("device_w"), t.get("device_h")
        if not dw or not dh:
            return rect
        dw = min(dw, rect["width"])
        dh = min(dh, rect["height"])
        dx = rect["x"] + max(0, (rect["width"] - dw) // 2)
        dy = rect["y"] + max(0, (rect["height"] - dh) // 2)
        return {"x": dx, "y": dy, "width": dw, "height": dh}

    def set_device_emulation(self, tab_id, device, width=None, height=None):
        from System import Func, Type

        form = self._get_form()
        t = self._tabs.get(tab_id)
        if form is None or not t or t.get("control") is None:
            return {"error": "Onglet introuvable"}

        control = t["control"]
        rect = self._content_rect or {"x": 0, "y": 74, "width": 900, "height": 626}

        w = h = ua = label = None
        if device == "custom":
            try:
                w = max(200, min(2000, int(width)))
                h = max(200, min(2000, int(height)))
            except (TypeError, ValueError):
                return {"error": "Dimensions invalides"}
            label = "Personnalisé"
            # A custom size is purely a viewport test -- it doesn't force
            # its own UA the way a named preset does, it just keeps
            # whatever UA is already active (a preset's, or the real one).
            ua = t.get("device_ua") or t.get("default_ua")
        else:
            preset = history.DEVICE_PRESETS.get(device) if device else None
            if preset:
                w, h, ua, label = preset["width"], preset["height"], preset["ua"], preset["label"]
            else:
                device = None
                ua = t.get("default_ua")

        def _do():
            try:
                core = control.CoreWebView2
            except Exception:
                core = None
            if core is not None and ua:
                try:
                    core.Settings.UserAgent = ua
                except Exception:
                    pass

            t["device"] = device
            t["device_w"] = w
            t["device_h"] = h
            t["device_label"] = label
            t["device_ua"] = ua
            control.Bounds = self._scaled_rect(self._device_rect_for(t, rect))

            if core is not None:
                # A UA change only affects the *next* navigation/reload --
                # without this, the page a user was already looking at
                # keeps whatever UA-dependent markup the server sent on
                # its original (pre-emulation) request.
                try:
                    core.Reload()
                except Exception:
                    pass

        form.Invoke(Func[Type](_do))
        self._push_tabs()
        return {"ok": True, "device": t.get("device"), "width": w, "height": h}

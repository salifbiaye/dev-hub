"""Thin entrypoint: builds Api(), creates the window, webview.start()."""
import os
import sys
import threading
from pathlib import Path

import webview

import icons
from api import Api
from app_config import load_config
from core.server.static_server import serve_own_ui
from features.browser.windows import window as browser_window
from features.window_chrome.controls import kill_all_running, start_fullscreen_watch

# WebView2 inherits the system/VPN proxy by default, which often has no
# localhost bypass — that routes the preview iframe's 127.0.0.1/localhost
# dev-server requests through a proxy that obviously can't reach them
# ("localhost refused to connect"), even though a real browser (with its
# own separate proxy handling) still connects fine to the same URL. This
# forces WebView2's underlying Chromium to always bypass the proxy for
# loopback addresses. Must be set before webview.start() creates the
# WebView2 environment, so it's done at import time here.
#
# This env var is only reliably picked up by an environment that doesn't
# also set its own CreationProperties.AdditionalBrowserArguments
# explicitly -- the browser window's tab-content controls do, so they need
# the same bypass folded into that explicit string themselves, or they'd
# silently lose this protection even though the env var is set.
_PROXY_BYPASS_ARG = "--proxy-bypass-list=localhost;127.0.0.1;<local>"
os.environ.setdefault("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", _PROXY_BYPASS_ARG)


def main():
    api = Api()
    dev_url = os.environ.get("DEV_HUB_DEV_URL")
    if dev_url:
        target = dev_url
        browser_window.set_own_ui_base(dev_url.rstrip("/"))
    else:
        base = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).parent.parent
        dist_dir = base / "frontend" / "dist"
        own_port = serve_own_ui(dist_dir)
        # "localhost", not the literal 127.0.0.1 it resolves to — the two
        # are different *sites* to Chromium's cookie/storage partitioning
        # even though they're the same machine, so a previewed dev server
        # on http://localhost:3000 would still be cross-site (and get its
        # cookies isolated on a hard reload) against a 127.0.0.1 top-level
        # page. Matching hostnames puts both under the same site.
        own_ui_base = f"http://localhost:{own_port}"
        browser_window.set_own_ui_base(own_ui_base)
        target = f"{own_ui_base}/index.html"

    window = webview.create_window(
        "Dev Hub",
        target,
        js_api=api,
        width=1100,
        height=720,
        min_size=(800, 600),
        frameless=True,
        easy_drag=False,
        background_color="#0a0a0c",
    )
    window.events.closing += kill_all_running
    window.events.closing += browser_window.close_all_preview_windows

    # Stale WebView2 profile dirs from past launches otherwise only get
    # cleaned when someone happens to open Processus and click the button —
    # the current session's own dir is always skipped (still locked), so
    # there's nothing to lose by doing this unattended on every startup.
    threading.Thread(target=api.clean_stale_webview_temp, daemon=True).start()
    threading.Thread(target=start_fullscreen_watch, daemon=True).start()

    # Match the taskbar icon to whichever theme was last saved, rather than
    # leaving it on the default accent until the user happens to switch
    # themes once in this session.
    threading.Thread(
        target=lambda: icons.apply_window_icon(load_config().get("theme", "dark"), retries=10), daemon=True
    ).start()

    # Keep pywebview's default private mode: setting private_mode=False with a
    # storage_path broke the JS API bridge in the frozen build (the window
    # rendered but window.pywebview.api never appeared, so nothing loaded).
    webview.start()


if __name__ == "__main__":
    main()

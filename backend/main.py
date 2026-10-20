"""Thin entrypoint: builds Api(), creates the window, webview.start()."""
import os
import sys
import threading
from pathlib import Path

import webview

import icons
from api import Api
from core import page_watchdog
from app_config import load_config
from core.platform import platform_svc
from core.server.static_server import serve_own_ui
from core.ui_files import clean_stale_unpack_dirs, ui_dist_dir
from features.hubi import api as hubi_api
from features.hubi import process as hubi_process
from features.window_chrome.controls import kill_all_running, start_fullscreen_watch

# Windows path is unchanged; Linux gets its own simplified "one tab = one
# window" browser module (see features/browser/linux/window.py) with the
# same set_own_ui_base()/close_all_preview_windows() surface.
if sys.platform == "win32":
    from features.browser.windows import window as browser_window
else:
    from features.browser.linux import window as browser_window

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
#
# Chromium's native occlusion tracking also stops painting a window it wrongly
# believes hidden — after a virtual-desktop switch or behind a topmost window —
# and it doesn't always resume: the window stays black. Off for every WebView2
# here, along with the backgrounding of "occluded" windows. ElasticOverscroll is
# pywebview's own argument, which the variable replaces.
_PROXY_BYPASS_ARG = (
    "--proxy-bypass-list=localhost;127.0.0.1;<local>"
    " --disable-features=ElasticOverscroll,CalculateNativeWinOcclusion"
    " --disable-backgrounding-occluded-windows"
)
os.environ.setdefault("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", _PROXY_BYPASS_ARG)


def main():
    # One Dev Hub at a time: launching it again shows the one already open.
    if not os.environ.get("DEV_HUB_MULTI") and not platform_svc.claim_single_instance():
        platform_svc.focus_running_instance()
        return
    api = Api()
    if getattr(sys, "frozen", False):
        # Leftover unpack folders of force-killed runs (see core/ui_files.py).
        threading.Thread(target=clean_stale_unpack_dirs, daemon=True).start()
    dev_url = os.environ.get("DEV_HUB_DEV_URL")
    if dev_url:
        target = dev_url
        ui_base = dev_url.rstrip("/")
        browser_window.set_own_ui_base(ui_base)
    else:
        own_port = serve_own_ui(ui_dist_dir())
        # "localhost", not the literal 127.0.0.1 it resolves to — the two
        # are different *sites* to Chromium's cookie/storage partitioning
        # even though they're the same machine, so a previewed dev server
        # on http://localhost:3000 would still be cross-site (and get its
        # cookies isolated on a hard reload) against a 127.0.0.1 top-level
        # page. Matching hostnames puts both under the same site.
        own_ui_base = f"http://localhost:{own_port}"
        browser_window.set_own_ui_base(own_ui_base)
        ui_base = own_ui_base
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

    # Once the native window exists: make it a regular OS window (Aero Snap,
    # edge resize) under our own HTML title bar — see core/platform/windows/snap.py.
    def _on_shown():
        from core.platform import platform_svc

        platform_svc.enable_native_frame(window)

    window.events.shown += _on_shown

    def _on_loaded():
        from features.repos.settings import save_theme_vars_snapshot

        threading.Thread(target=save_theme_vars_snapshot, daemon=True).start()

    window.events.loaded += _on_loaded
    # Black-window safety net: reload the page if it stops painting.
    window.events.shown += lambda: page_watchdog.start(window, target)

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


def main_hubi():
    """`DevHub.exe --hubi`: only Hubi (eyes + tray icon), no Dev Hub window.
    Its own process — see features/hubi/process.py."""
    if not hubi_process.claim_instance():
        return
    if sys.platform == "win32":
        # Its own taskbar identity: otherwise Windows groups Hubi's window
        # under DevHub.exe and shows Dev Hub's icon for it.
        try:
            import ctypes

            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("SalifBiaye.DevHub.Hubi")
        except Exception:
            pass
        # Hubi's beeps use WebAudio, which WebView2 keeps muted until the page
        # is clicked (autoplay policy); Hubi is rarely clicked. Its WebView2 runs
        # in private mode with its own browser process, so this only affects
        # Hubi. Same base arguments as Dev Hub (proxy bypass, no occlusion).
        os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = _PROXY_BYPASS_ARG + " --autoplay-policy=no-user-gesture-required"
    try:
        port = serve_own_ui(ui_dist_dir())
        hubi_api.start(f"http://localhost:{port}")
        webview.start()
        hubi_api.stop()
    finally:
        hubi_process.release_instance()


if __name__ == "__main__":
    if "--hubi" in sys.argv:
        main_hubi()
    else:
        main()

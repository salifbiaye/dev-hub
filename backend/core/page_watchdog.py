"""Reload Dev Hub's main page when it stops painting (black window).

WebView2 can keep a window alive yet stop drawing it (seen after a virtual
desktop switch or a resume from sleep), leaving a black rectangle. The page
counts its drawn frames in window.__devhub_frames (frontend/src/main.jsx);
if the count stops moving while the window is on screen, the page is reloaded.
Not while a Code-tab edit is unsaved (window.__devhub_dirty): a reload would
lose it. A minimized or hidden window is skipped: Chromium rightly pauses
drawing there.
"""
import threading
import time

from core.platform import platform_svc

INTERVAL = 4.0  # s between checks
STALL = 24.0  # s without a new frame before the page is reloaded
STARTUP_STALL = 8.0  # s to wait for the first page paint after opening
EVAL_TIMEOUT = 4.0  # s: a page that cannot answer at all counts as stalled
_TIMEOUT = object()


def _evaluate(window, js):
    box = {}

    def run():
        try:
            box["value"] = window.evaluate_js(js)
        except Exception:
            box["value"] = None

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(EVAL_TIMEOUT)
    return _TIMEOUT if thread.is_alive() else box.get("value")


def _loop(window, url, stop):
    last_frames, stalled_since, saw_page = None, None, False
    while not stop.wait(INTERVAL):
        if not platform_svc.window_is_showing(window):
            last_frames = stalled_since = None
            continue
        value = _evaluate(window, "[window.__devhub_frames || 0, !!window.__devhub_dirty]")
        alive = isinstance(value, (list, tuple)) and len(value) == 2
        frames, dirty = (value if alive else (None, False))
        if alive and frames != last_frames:
            last_frames, stalled_since, saw_page = frames, None, True
            continue
        now = time.monotonic()
        stalled_since = stalled_since or now
        # A launch that never reaches JavaScript is different from an already
        # rendered page that later stalls: recover the former quickly instead
        # of showing a black window for the normal 24-second watchdog delay.
        limit = STALL if saw_page else STARTUP_STALL
        if now - stalled_since < limit or dirty:
            continue
        last_frames = stalled_since = None
        try:
            if alive:
                window.evaluate_js("location.reload()")
            else:
                # A dead page cannot reload itself; a fresh query string makes
                # WebView2 really navigate (same URL would be a no-op).
                window.load_url(f"{url}?r={int(time.time())}")
        except Exception:
            pass


def start(window, url):
    stop = threading.Event()
    threading.Thread(target=_loop, args=(window, url, stop), daemon=True).start()
    return stop.set

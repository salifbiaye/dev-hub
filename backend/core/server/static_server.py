import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class _QuietHTTPHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass  # keep the app's stdout clean, same as _ProxyHandler

    def end_headers(self):
        # The main window's WebView2 profile is ephemeral (pywebview's
        # default private mode), so it never noticed this, but the browser
        # window's tabs deliberately use a *persistent* profile
        # (_browser_profile_dir) so logins survive app restarts — and
        # SimpleHTTPRequestHandler sends no Cache-Control at all, so that
        # persistent profile can go on serving a stale cached
        # browser.html/start.html from disk after a rebuild instead of
        # re-fetching. Every asset here is either generated fresh per
        # request or rebuilt as a whole on each `npm run build`, so there's
        # never a reason to let anything from this server be cached.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve_own_ui(dist_dir):
    # Dev Hub's own UI used to load from a file:// path. A Processus
    # preview iframe pointing at a local dev server (http://localhost:X)
    # is then a *cross-site* embed relative to that file:// top-level page
    # (no registrable domain in common at all), so Chromium/WebView2 treats
    # its cookies as third-party and isolates/drops them — a login that
    # works fine in a real browser tab can silently fail to "stick" inside
    # the iframe. Serving Dev Hub itself over http://127.0.0.1 instead
    # doesn't make it literally the same origin as the previewed app, but
    # both are under the `localhost`/loopback site, so the iframe becomes
    # same-site instead of cross-site and stops being subject to that
    # isolation.
    handler = partial(_QuietHTTPHandler, directory=str(dist_dir))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return port

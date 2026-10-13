"""Hubi's local control server: 127.0.0.1 only, POST + JSON only, every
request must carry the shared token (?token= or X-Hubi-Token)."""
import hmac
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from . import channel

MAX_BODY = 64 * 1024

_server = None


class _Server(ThreadingHTTPServer):
    # Windows' SO_REUSEADDR would let us bind a port another program already
    # listens on; we want a clean failure and the next port instead.
    allow_reuse_address = False
    daemon_threads = True


def _make_handler(token, routes):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Hubi"
        sys_version = ""

        def log_message(self, *args):
            pass

        def _reply(self, code, body=None):
            data = json.dumps(body).encode("utf-8") if body is not None else b""
            self.send_response(code)
            if data:
                self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if data:
                self.wfile.write(data)

        def _refuse(self):
            self._reply(405, {"error": "méthode non autorisée"})

        do_GET = do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _refuse

        def do_POST(self):
            url = urlsplit(self.path)
            given = self.headers.get("X-Hubi-Token") or (parse_qs(url.query).get("token") or [""])[0]
            if not hmac.compare_digest(given.encode("utf-8"), token.encode("utf-8")):
                return self._reply(403, {"error": "jeton invalide"})
            route = routes.get(url.path)
            if route is None:
                return self._reply(404, {"error": "inconnu"})
            if self.headers.get("Transfer-Encoding"):
                return self._reply(411, {"error": "Content-Length requis"})
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return self._reply(400, {"error": "Content-Length invalide"})
            if length < 0 or length > MAX_BODY:
                return self._reply(413, {"error": "trop volumineux"})
            raw = self.rfile.read(length) if length else b""
            payload = {}
            if raw.strip():
                if "json" not in (self.headers.get("Content-Type") or "").lower():
                    return self._reply(415, {"error": "JSON attendu"})
                try:
                    payload = json.loads(raw.decode("utf-8-sig"))
                except Exception:
                    return self._reply(400, {"error": "JSON invalide"})
                if not isinstance(payload, dict):
                    return self._reply(400, {"error": "objet JSON attendu"})
            try:
                route(payload)
            except ValueError as e:
                return self._reply(400, {"error": str(e)})
            except Exception:
                return self._reply(500, {"error": "erreur interne"})
            # No body: Claude Code adds a UserPromptSubmit hook's stdout to
            # the conversation, so the hook must print nothing.
            self._reply(204)

    return Handler


def start(routes):
    """Bind the fixed port (or a fallback), publish {port, token} in
    hubi.json and serve in a daemon thread. Returns the port or None."""
    global _server
    if _server is not None:
        return _server.server_address[1]
    token = channel.get_token()
    handler = _make_handler(token, routes)
    for port in (channel.PORT, *channel.PORT_FALLBACKS):
        try:
            _server = _Server(("127.0.0.1", port), handler)
            break
        except OSError:
            continue
    if _server is None:
        print("[hubi] aucun port libre pour le serveur de contrôle")
        return None
    port = _server.server_address[1]
    channel.write_info(port, token)
    threading.Thread(target=_server.serve_forever, daemon=True).start()
    return port


def stop():
    global _server
    srv, _server = _server, None
    if srv is not None:
        try:
            srv.shutdown()
            srv.server_close()
        except Exception:
            pass

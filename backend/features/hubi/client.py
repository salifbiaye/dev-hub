"""Dev Hub → Hubi: fire-and-forget POSTs to Hubi's local server. Hubi not
running is the normal case, so every failure is silently ignored."""
import json
import threading
import urllib.request

from . import channel


def send_sync(path, payload=None, timeout=1.0):
    info = channel.read_info()
    if info is None:
        return False
    port, token = info
    data = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "X-Hubi-Token": token},
    )
    # No proxy: a system/VPN proxy without a loopback bypass would swallow it.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as res:
            return 200 <= res.status < 300
    except Exception:
        return False


def send(path, payload=None):
    threading.Thread(target=send_sync, args=(path, payload), daemon=True).start()


def event(kind, project=None, message=None):
    send("/event", {"kind": kind, "project": project, "message": message})

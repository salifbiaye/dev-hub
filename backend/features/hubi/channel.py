"""Where Hubi's local control server listens, and the shared secret that
every request must carry. Used by both processes (Hubi serves, Dev Hub and
Claude Code hooks call it)."""
import json
import secrets

from app_config import APP_DATA_DIR, load_config, save_config

PORT = 47621
PORT_FALLBACKS = range(47622, 47631)
INFO_FILE = APP_DATA_DIR / "hubi.json"


def get_token():
    """Stable across runs: Claude Code hook commands embed it."""
    config = load_config()
    hubi = config.get("hubi") or {}
    token = hubi.get("token")
    if isinstance(token, str) and len(token) >= 16:
        return token
    token = secrets.token_hex(16)
    hubi["token"] = token
    config["hubi"] = hubi
    save_config(config)
    return token


def write_info(port, token):
    INFO_FILE.write_text(json.dumps({"port": port, "token": token}), encoding="utf-8")


def read_info():
    try:
        info = json.loads(INFO_FILE.read_text(encoding="utf-8"))
        return int(info["port"]), str(info["token"])
    except Exception:
        return None

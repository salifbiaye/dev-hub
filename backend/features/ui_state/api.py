"""UI state that must survive a restart (open tabs, selected project…): the page's
localStorage is mirrored here (see frontend/src/persistentStorage.js) because the
embedded browser runs in private mode and forgets it when the app closes."""
import json
import os
import threading

from app_config import APP_DATA_DIR

STATE_FILE = APP_DATA_DIR / "ui_state.json"
MAX_TOTAL = 4_000_000  # chars; a stray huge value must not bloat the file forever

_lock = threading.Lock()


def _read():
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


class UiStateMixin:
    def kv_load(self):
        with _lock:
            return _read()

    def kv_set_many(self, changes):
        if not isinstance(changes, dict):
            return {"error": "Format invalide"}
        with _lock:
            data = _read()
            for key, value in changes.items():
                if value is None:
                    data.pop(str(key), None)
                elif isinstance(value, str):
                    data[str(key)] = value
            while data and sum(len(v) for v in data.values()) > MAX_TOTAL:
                data.pop(next(iter(data)))
            try:
                STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
                tmp = STATE_FILE.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                os.replace(tmp, STATE_FILE)
            except OSError as e:
                return {"error": str(e)}
        return {"ok": True}

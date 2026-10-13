"""Hubi's countdown timer. State lives in config.json ("hubi"."timer") so it
survives restarts, and so Dev Hub can set it before launching Hubi."""
import threading
import time

from app_config import load_config, save_config

MAX_SECONDS = 24 * 3600
STALE_AFTER = 12 * 3600  # a timer that ended this long ago while Hubi was off is dropped

_lock = threading.Lock()
_watcher = None
_current = None  # Hubi process: in-memory copy of the persisted timer


def _read():
    try:
        timer = (load_config().get("hubi") or {}).get("timer")
    except Exception:
        return None
    if isinstance(timer, dict) and isinstance(timer.get("end"), (int, float)):
        return {"end": float(timer["end"]), "label": str(timer.get("label") or "Minuteur")}
    return None


def _write(timer):
    config = load_config()
    hubi = config.get("hubi") or {}
    hubi["timer"] = timer
    config["hubi"] = hubi
    save_config(config)


def state():
    return _read()


def persist(seconds, label=None):
    """Validate and store a timer. Returns the stored state or None."""
    try:
        seconds = int(float(seconds))
    except (TypeError, ValueError):
        return None
    if seconds < 1 or seconds > MAX_SECONDS:
        return None
    label = " ".join(str(label or "").split())[:60] or "Minuteur"
    timer = {"end": time.time() + seconds, "label": label}
    _write(timer)
    return timer


def clear():
    _write(None)


# ---------------------------------------------------------------- Hubi process side

def _push_state(timer):
    from . import window

    if timer:
        window.push_cmd("timer", int(timer["end"] * 1000), timer["label"])
    else:
        window.push_cmd("timer", None, None)


def start(seconds, label=None):
    global _current
    from . import reactions

    with _lock:
        timer = persist(seconds, label)
        if timer is None:
            return False
        _current = timer
    reactions.clear_ringing()
    _push_state(timer)
    return True


def cancel():
    global _current
    with _lock:
        _current = None
        clear()
    _push_state(None)


def running():
    return _current


def _check():
    global _current
    with _lock:
        timer = _current
        if not timer or time.time() < timer["end"]:
            return
        _current = None
        try:
            clear()
        except Exception:
            pass
    from . import reactions

    _push_state(None)
    if time.time() - timer["end"] < STALE_AFTER:
        reactions.timer_rang(timer["label"])


def _watch():
    while True:
        try:
            _check()
        except Exception:
            pass
        time.sleep(0.5)


def start_watcher():
    """Called once in the Hubi process: announces a running timer to the page
    and rings when it ends (also if it ended while Hubi was closed)."""
    global _watcher, _current
    if _watcher is not None:
        return
    _current = _read()
    if _current and _current["end"] > time.time():
        _push_state(_current)
    _watcher = threading.Thread(target=_watch, daemon=True)
    _watcher.start()

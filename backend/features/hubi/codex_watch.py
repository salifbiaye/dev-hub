"""Codex sessions -> Hubi, without touching ~/.codex/config.toml.

Codex has a single `notify` command (often already taken, e.g. by its own
computer-use tool), so instead Hubi follows the session files Codex writes
anyway: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl. Each line is an event;
`task_started` / `task_complete` (with an `error` when the turn failed) bracket
every turn. Only lines written after Hubi started are read, so history is
never replayed.
"""
import json
import threading
import time
from pathlib import Path

from app_config import load_config

from . import reactions

ROOT = Path.home() / ".codex" / "sessions"
TAIL_EVERY = 1.0  # s between reads of the active files
SCAN_EVERY = 10.0  # s between looks for new / newly active files
ACTIVE_FOR = 15 * 60  # a file untouched for this long is no longer followed

_files = {}  # path -> {"offset", "rest", "cwd", "sid"}
_stop = threading.Event()
_thread = None


def notify_flag():
    return bool((load_config().get("hubi") or {}).get("codex_notify", True))


def enabled():
    """Only while Codex is the agent chosen in Paramètres IA."""
    from features.terminal.sessions import cli_kind

    return ROOT.exists() and notify_flag() and cli_kind() == "codex"


def _first_meta(path):
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            obj = json.loads(fh.readline() or "{}")
        if obj.get("type") == "session_meta":
            payload = obj.get("payload") or {}
            return payload.get("cwd"), payload.get("id")
    except (OSError, ValueError):
        pass
    return None, None


def _scan(first):
    now = time.time()
    for path in ROOT.rglob("rollout-*.jsonl"):
        if path in _files:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        if now - stat.st_mtime > ACTIVE_FOR:
            continue
        cwd, sid = _first_meta(path)
        # Files already there at startup: only what they get from now on.
        # Files that appear later are new sessions: read them from the start.
        _files[path] = {"offset": stat.st_size if first else 0, "rest": "", "cwd": cwd, "sid": sid or path.stem}
    for path in [p for p in _files if not p.exists() or now - p.stat().st_mtime > ACTIVE_FOR]:
        _files.pop(path, None)


def _error_text(error):
    if isinstance(error, dict):
        error = error.get("message") or ""
    text = " ".join(str(error or "").split())
    if "usage limit" in text.lower():
        return "Codex : limite d'utilisation atteinte"
    return f"Codex s'est arrêté : {text[:120]}" if text else "Codex s'est arrêté sur une erreur"


def _handle(entry, obj):
    payload = obj.get("payload") or {}
    if obj.get("type") == "session_meta":
        entry["cwd"], entry["sid"] = payload.get("cwd") or entry["cwd"], payload.get("id") or entry["sid"]
        return
    if obj.get("type") != "event_msg":
        return
    kind = payload.get("type") or ""
    project = reactions.project_name(entry["cwd"])
    session = f"codex:{entry['sid']}"
    if kind == "task_started":
        reactions.handle_event("claude_working", project, None, session, tool="codex")
    elif kind == "task_complete":
        if payload.get("error"):
            reactions.handle_event("claude_error", project, _error_text(payload["error"]), session, tool="codex")
        else:
            reactions.handle_event("claude_done", project, "Codex a terminé", session, tool="codex")
    elif kind.endswith("approval_request"):
        reactions.handle_event("claude_waiting", project, "Codex attend ton accord", session, tool="codex")
    elif kind == "turn_aborted":
        reactions.handle_event("claude_end", project, None, session, tool="codex")


def _tail():
    for path, entry in list(_files.items()):
        try:
            size = path.stat().st_size
            if size < entry["offset"]:  # rewritten: start over
                entry["offset"], entry["rest"] = 0, ""
            if size == entry["offset"]:
                continue
            with path.open("rb") as fh:
                fh.seek(entry["offset"])
                chunk = fh.read(size - entry["offset"])
            entry["offset"] = size
        except OSError:
            continue
        lines = (entry["rest"] + chunk.decode("utf-8", errors="replace")).split("\n")
        entry["rest"] = lines.pop()  # an unfinished last line waits for the rest
        for line in lines:
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            try:
                _handle(entry, obj)
            except Exception:
                pass


def _loop():
    first, last_scan = True, 0.0
    while not _stop.wait(TAIL_EVERY):
        if not enabled():
            _files.clear()
            first = True
            continue
        if time.monotonic() - last_scan > SCAN_EVERY:
            last_scan = time.monotonic()
            try:
                _scan(first)
            except OSError:
                pass
            first = False
        _tail()


def start():
    global _thread
    if _thread is not None:
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, daemon=True)
    _thread.start()


def stop():
    global _thread
    _stop.set()
    _thread = None

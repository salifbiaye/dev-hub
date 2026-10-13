"""Turns events (Claude Code sessions, Dev Hub runs, the timer) into what Hubi
shows: a persistent mood, a sticky bubble, transient moods/bubbles and beeps.

Claude state is tracked per session so one session finishing never clears
another session's pending question. Persistent mood priority:
ringing timer / waiting session → alert, working session → acting (iris-circuit; "focused" read as frowning).
"""
import ntpath
import posixpath
import threading
import time

from . import window

BUBBLE_MS = 6000
MAX_TEXT = 300
SESSION_TTL = 6 * 3600  # a session silent for this long is considered gone

_lock = threading.Lock()
_sessions = {}  # key -> {"state": "working"|"waiting", "project", "message", "at"}
_ringing = None  # label of a finished timer not yet acknowledged
_shown = {"base": None, "sticky": None}

_STOP_ERRORS = {
    "authentication_failed": "échec d'authentification",
    "billing_error": "problème de facturation",
    "rate_limit": "limite d'utilisation atteinte",
    "invalid_request": "requête invalide",
    "server_error": "erreur serveur",
    "max_output_tokens": "réponse trop longue",
}


def _clean(text, limit=MAX_TEXT):
    if text is None:
        return ""
    text = " ".join(str(text).split())
    return text[:limit]


def project_name(cwd):
    cwd = _clean(cwd, 1000).rstrip("\\/")
    if not cwd:
        return ""
    return ntpath.basename(cwd) or posixpath.basename(cwd)


def _prefix(project):
    return f"{project} : " if project else ""


def _beep(kind):
    if window.sound_enabled():
        window.push_cmd("beep", kind)


def _bubble(text, tone="info", ms=BUBBLE_MS):
    window.push_cmd("bubble", _clean(text), ms, tone)


def _compute():
    now = time.time()
    for key in [k for k, s in _sessions.items() if now - s["at"] > SESSION_TTL]:
        _sessions.pop(key, None)
    waiting = sorted((s for s in _sessions.values() if s["state"] == "waiting"), key=lambda s: s["at"])
    if _ringing is not None:
        sticky = (f"⏰ {_ringing} terminé", "warn")
    elif waiting:
        last = waiting[-1]
        extra = f" (+{len(waiting) - 1})" if len(waiting) > 1 else ""
        sticky = (f"✋ {_prefix(last['project'])}{last['message']}{extra}", "warn")
    else:
        sticky = None
    if sticky or waiting:
        base = "alert"
    elif any(s["state"] == "working" for s in _sessions.values()):
        base = "acting"
    else:
        base = "normal"
    return base, sticky


def _publish(transient_mood=None):
    """Push the persistent state if it changed, then the transient mood (the
    page drops any running overlay when its base mood changes)."""
    with _lock:
        base, sticky = _compute()
        base_changed = base != _shown["base"]
        sticky_changed = sticky != _shown["sticky"]
        _shown["base"], _shown["sticky"] = base, sticky
    if sticky_changed:
        window.push_cmd("sticky", _clean(sticky[0]) if sticky else None, sticky[1] if sticky else None)
    if base_changed:
        window.send_mood(base, 0)
    if transient_mood:
        window.send_mood(transient_mood, None)


def handle_event(kind, project=None, message=None, session=None):
    project = _clean(project, 80)
    message = _clean(message)
    key = session or f"p:{project}"
    transient = None
    with _lock:
        if kind == "claude_working":
            _sessions[key] = {"state": "working", "project": project, "message": "", "at": time.time()}
        elif kind == "claude_waiting":
            _sessions[key] = {
                "state": "waiting",
                "project": project,
                "message": message or "Claude attend ta réponse",
                "at": time.time(),
            }
        elif kind in ("claude_done", "claude_error", "claude_end"):
            _sessions.pop(key, None)
    if kind == "claude_waiting":
        _beep("waiting")
    elif kind == "claude_done":
        _bubble(f"✅ {_prefix(project)}{message or 'Claude a terminé'}", "ok")
        _beep("done")
        transient = "happy"
    elif kind in ("claude_error", "run_error"):
        default = "Claude a rencontré une erreur" if kind == "claude_error" else "Échec"
        _bubble(f"❌ {_prefix(project)}{message or default}", "error", 9000)
        _beep("error")
        transient = "error"
    elif kind == "run_done":
        _bubble(f"✅ {_prefix(project)}{message or 'Terminé'}", "ok")
        transient = "happy"
    elif kind == "info":
        if message:
            _bubble(f"{_prefix(project)}{message}", "info")
    _publish(transient)


def handle_claude_hook(data):
    """Raw Claude Code hook stdin JSON (see claude_hooks.py for the events)."""
    name = data.get("hook_event_name")
    project = project_name(data.get("cwd"))
    session = _clean(data.get("session_id"), 100) or None
    if name == "UserPromptSubmit":
        handle_event("claude_working", project, None, session)
    elif name == "Notification":
        ntype = data.get("notification_type")
        if ntype == "idle_prompt":
            # Already finished; just a gentle reminder, not a sticky alert.
            handle_event("info", project, "Claude attend ta réponse", session)
        elif ntype in (None, "permission_prompt", "elicitation_dialog"):
            handle_event("claude_waiting", project, data.get("message"), session)
    elif name == "Stop":
        handle_event("claude_done", project, None, session)
    elif name == "StopFailure":
        reason = _STOP_ERRORS.get(data.get("error"), "")
        message = f"Claude s'est arrêté : {reason}" if reason else "Claude s'est arrêté sur une erreur"
        handle_event("claude_error", project, message, session)
    elif name == "SessionEnd":
        handle_event("claude_end", project, None, session)


def timer_rang(label):
    global _ringing
    with _lock:
        _ringing = _clean(label, 80) or "Minuteur"
    _beep("timer")
    _publish()


def clear_ringing():
    global _ringing
    with _lock:
        _ringing = None
    _publish()


def dismiss():
    """Click on Hubi: acknowledge the timer and every pending question (the
    sessions keep going, so they fall back to "working")."""
    global _ringing
    with _lock:
        _ringing = None
        for s in _sessions.values():
            if s["state"] == "waiting":
                s["state"] = "working"
    _publish()

"""Browser sign-in for the AI agents: runs the CLI's own login (`claude auth
login`, `codex login`) in the background. The CLI opens the browser (Google,
e-mail, SSO… whatever the provider offers); Dev Hub also surfaces the link it
prints so the user can open or copy it, and saves the new account when the
login completes."""
import os
import re
import subprocess
import threading
import time
from urllib.parse import urlparse

from core.platform import platform_svc

from . import store

LOGIN_TIMEOUT = 300  # seconds the user has to finish in the browser

_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
_URL = re.compile(r"https?://[^\s'\"<>]+")
_DEVICE_CODE = re.compile(r"\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b")
_NEEDS_CODE = re.compile(r"paste|enter the code|code here", re.IGNORECASE)

_lock = threading.Lock()
_sessions = {}


class _Session:
    def __init__(self, agent):
        self.agent = agent
        self.proc = None
        self.state = "starting"  # starting | waiting | done | error | cancelled
        self.url = None
        self.device_code = None
        self.needs_code = False
        self.error = None
        self.email = None
        self.lines = []
        self.started = time.time()
        self.before_key = None


def _is_local(url):
    host = (urlparse(url).hostname or "").lower()
    return host in ("localhost", "127.0.0.1", "::1", "0.0.0.0")


def _argv(agent, binary, email=None, device=False):
    if agent == "claude-code":
        argv = [binary, "auth", "login", "--claudeai"]
        if email:
            argv += ["--email", email]
        return argv
    argv = [binary, "login"]
    if device:
        argv.append("--device-auth")
    return argv


def _read_output(session):
    for raw in session.proc.stdout:
        line = _ANSI.sub("", raw).strip()
        if not line:
            continue
        with _lock:
            session.lines = (session.lines + [line])[-30:]
            if session.url is None:
                for url in _URL.findall(line):
                    if not _is_local(url):
                        session.url = url.rstrip(".,)")
                        break
            if session.device_code is None:
                m = _DEVICE_CODE.search(line)
                if m and "code" in line.lower():
                    session.device_code = m.group(0)
            if _NEEDS_CODE.search(line):
                session.needs_code = True
            if session.state == "starting" and (session.url or session.device_code):
                session.state = "waiting"


def _watch(session):
    code = None
    while code is None:
        try:
            code = session.proc.wait(timeout=1)
        except subprocess.TimeoutExpired:
            if time.time() - session.started > LOGIN_TIMEOUT:
                platform_svc.kill_process_tree(session.proc.pid)
                with _lock:
                    if session.state not in ("done", "cancelled"):
                        session.state = "error"
                        session.error = "Délai dépassé : la connexion n'a pas été terminée dans le navigateur."
                return
    time.sleep(0.3)  # let the output reader drain the last lines
    with _lock:
        if session.state == "cancelled":
            return
    if code == 0:
        entry = store.refresh_active(session.agent)
        with _lock:
            if entry:
                session.state = "done"
                session.email = entry.get("email")
            else:
                session.state = "error"
                session.error = "La connexion s'est terminée mais aucun compte n'a été détecté."
        return
    _restore(session)
    with _lock:
        session.state = "error"
        tail = [l for l in session.lines if not l.startswith("http")][-2:]
        session.error = " ".join(tail) or "La connexion a échoué ou a été annulée."


def _restore(session):
    """Put the previous account back if a failed/cancelled login changed it."""
    if not session.before_key:
        return
    live = store.live_identity(session.agent)
    if live and live["key"] == session.before_key:
        return
    saved = store.find_by_key(session.agent, session.before_key)
    if saved:
        store.switch(session.agent, saved["id"])


def start(agent, email=None, device=False):
    from features.terminal.sessions import cli_binary

    with _lock:
        running = _sessions.get(agent)
        if running and running.state in ("starting", "waiting"):
            return _status(running)
    binary = cli_binary(agent)
    if not binary:
        return {"error": "Commande du CLI introuvable : vérifie-la dans les réglages de l'agent."}
    live = store.refresh_active(agent)  # the account we may leave is saved first
    session = _Session(agent)
    session.before_key = live["key"] if live else None
    env = os.environ.copy()
    env["NO_COLOR"] = "1"
    env["TERM"] = "dumb"
    try:
        session.proc = subprocess.Popen(
            _argv(agent, binary, email, device),
            shell=(os.name == "nt"),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except FileNotFoundError:
        return {"error": f"Commande '{binary}' introuvable dans le PATH."}
    with _lock:
        _sessions[agent] = session
    threading.Thread(target=_read_output, args=(session,), daemon=True).start()
    threading.Thread(target=_watch, args=(session,), daemon=True).start()
    return _status(session)


def _status(session):
    with _lock:
        return {
            "state": session.state,
            "url": session.url,
            "device_code": session.device_code,
            "needs_code": session.needs_code,
            "error": session.error,
            "email": session.email,
        }


def status(agent):
    session = _sessions.get(agent)
    if session is None:
        return {"state": "idle"}
    return _status(session)


def cancel(agent):
    session = _sessions.get(agent)
    if session is None or session.state not in ("starting", "waiting"):
        return {"ok": True}
    with _lock:
        session.state = "cancelled"
    if session.proc:
        platform_svc.kill_process_tree(session.proc.pid)
    _restore(session)
    return {"ok": True}


def submit_code(agent, code):
    session = _sessions.get(agent)
    if session is None or session.proc is None or session.state not in ("starting", "waiting"):
        return {"error": "Aucune connexion en cours"}
    try:
        session.proc.stdin.write((code or "").strip() + "\n")
        session.proc.stdin.flush()
    except OSError as e:
        return {"error": str(e)}
    return {"ok": True}


def logout(agent):
    """Sign the CLI out and forget that account (the others stay saved)."""
    from features.terminal.sessions import cli_binary

    binary = cli_binary(agent)
    live = store.live_identity(agent)
    if not binary or not live:
        return {"ok": True}
    argv = [binary, "auth", "logout"] if agent == "claude-code" else [binary, "logout"]
    try:
        subprocess.run(
            argv,
            shell=(os.name == "nt"),
            capture_output=True,
            text=True,
            timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"error": str(e)}
    store.forget(agent, live["key"])
    return {"ok": True}

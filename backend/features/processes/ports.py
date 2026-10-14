"""« Port already in use »: who holds it, and freeing it.

A run that fails because its port is taken (Spring, Vite, Next, Django…)
often collides with a server started elsewhere — a Claude Code session, the
IDE, an old terminal — which is not an orphan of Dev Hub, so the orphan scan
never shows it. This finds the port in the run's output, then the process
listening on it, what launched it and which project it belongs to.
"""
import os
import re
import time
from pathlib import Path

import psutil

from app_config import load_config
from core.platform import platform_svc
from features.terminal import sessions as terminal_sessions

_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")
_PORT_PATTERNS = [
    re.compile(r"Port (\d{2,5}) was already in use", re.I),  # Spring Boot
    re.compile(r"port (\d{2,5}) is (?:already )?in use", re.I),  # Vite, Next, Angular…
    re.compile(r"EADDRINUSE[^\n]*?:(\d{2,5})", re.I),  # Node
    re.compile(r"address already in use[^\n]*?:(\d{2,5})", re.I),
    re.compile(r"(?:bind|listen)[^\n]*?:(\d{2,5})[^\n]*?(?:address already in use|only one usage)", re.I),
    re.compile(r"Error: That port is already in use", re.I),  # Django (no number)
]

# Process names (lowercase) -> label shown as "lancé par …".
_LAUNCHERS = {
    "claude.exe": "Claude Code",
    "claude": "Claude Code",
    "codex.exe": "Codex",
    "codex": "Codex",
    "devhub.exe": "Dev Hub",
    "idea64.exe": "IntelliJ IDEA",
    "webstorm64.exe": "WebStorm",
    "pycharm64.exe": "PyCharm",
    "rider64.exe": "Rider",
    "goland64.exe": "GoLand",
    "phpstorm64.exe": "PhpStorm",
    "code.exe": "VS Code",
    "cursor.exe": "Cursor",
    "windowsterminal.exe": "Windows Terminal",
    "explorer.exe": None,  # the desktop: nothing more useful to say
}


def port_from_output(text):
    text = _ANSI.sub("", text or "")
    port = None
    for pattern in _PORT_PATTERNS:
        for match in pattern.finditer(text):
            if match.groups():
                port = int(match.group(1))
    return port


def _listener(port):
    try:
        conns = psutil.net_connections("tcp")
    except Exception:
        return None
    for c in conns:
        if c.laddr and c.laddr.port == port and c.status == psutil.CONN_LISTEN and c.pid:
            return c.pid
    return None


def _project_of(paths):
    def norm(text):
        return os.path.normcase(os.path.normpath(text)) if text else ""

    repos = load_config().get("repos", [])
    for p in paths:
        hay = os.path.normcase(p.replace("/", os.sep)) if p else ""
        if not hay:
            continue
        for r in repos:
            if norm(r["path"]) in hay:
                return Path(r["path"]).name
    return None


def port_owner(port):
    pid = _listener(int(port))
    if not pid:
        return None
    try:
        proc = psutil.Process(pid)
        name = proc.name()
        cmdline = " ".join(proc.cmdline())
        try:
            cwd = proc.cwd()
        except Exception:
            cwd = None
    except psutil.Error:
        return None
    launcher = None
    try:
        for parent in proc.parents():
            label = _LAUNCHERS.get(parent.name().lower(), "")
            if label != "":
                launcher = label
                break
    except psutil.Error:
        pass
    return {
        "port": int(port),
        "pid": pid,
        "name": name,
        "command": cmdline[:400],
        "cwd": cwd,
        "project": _project_of([cwd, cmdline]),
        "launcher": launcher,
    }


class ProcessesPortsMixin:
    def run_port_conflict(self, terminal_id):
        """For a stopped run: the busy port named in its output and who holds
        it now, or {} if the run did not fail on a port (or it is free now)."""
        port = port_from_output(terminal_sessions.get_buffer(terminal_id))
        if not port:
            return {}
        owner = port_owner(port)
        return {"port": port, "owner": owner} if owner else {}

    def free_port(self, port):
        owner = port_owner(port)
        if not owner:
            return {"ok": True}
        result = platform_svc.kill_process_tree(owner["pid"])
        if not result.get("ok"):
            return {"error": result.get("error") or "Impossible d'arrêter le processus"}
        for _ in range(20):  # the OS releases the socket a moment later
            if not _listener(int(port)):
                return {"ok": True}
            time.sleep(0.15)
        return {"error": f"Le port {port} est toujours occupé"}

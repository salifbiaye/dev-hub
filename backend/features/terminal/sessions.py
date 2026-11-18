import json
import os
import re
import shlex
import threading
import uuid
from pathlib import Path

import webview

import shutil

from app_config import AGENT_PROVIDERS, ai_cli_command, ai_cli_commands, default_agent, load_config
from core.platform import platform_svc

# _terminals/_terminal_buffers are the single shared source of truth for
# every PTY session Dev Hub owns (the interactive AI terminal here, and the
# run-config terminals in features/processes/run_configs.py) — anything
# outside this module reaches them only through the functions below, never
# by importing the dicts directly.
_terminals = {}
_terminal_buffers = {}
_finished_buffers = {}
_TERMINAL_BUFFER_CAP = 200_000


def append_buffer(terminal_id, data):
    buf = _terminal_buffers.get(terminal_id, "") + data
    if len(buf) > _TERMINAL_BUFFER_CAP:
        buf = buf[-_TERMINAL_BUFFER_CAP:]
    _terminal_buffers[terminal_id] = buf


def register(terminal_id, proc):
    _terminals[terminal_id] = proc


def get(terminal_id):
    return _terminals.get(terminal_id)


def pop(terminal_id):
    return _terminals.pop(terminal_id, None)


def finished_buffer(terminal_id):
    return _finished_buffers.get(terminal_id, "")


def get_buffer(terminal_id):
    return _terminal_buffers.get(terminal_id, "")


def pop_buffer(terminal_id):
    _terminal_buffers.pop(terminal_id, None)


def all_terminals():
    return _terminals


def kill_all_running():
    for proc in list(_terminals.values()):
        try:
            proc.close(force=True)
        except Exception:
            pass
    _terminals.clear()


def stream_terminal(terminal_id, proc):
    window = webview.windows[0]
    try:
        while proc.isalive():
            try:
                data = proc.read(4096)
            except EOFError:
                break
            if data:
                append_buffer(terminal_id, data)
                try:
                    window.evaluate_js(
                        f"window.__devhub_onTerminalData && window.__devhub_onTerminalData({json.dumps(terminal_id)}, {json.dumps(data)})"
                    )
                except Exception:
                    pass
    except Exception:
        pass
    _terminals.pop(terminal_id, None)
    # The output of a finished terminal stays readable for a while (test runs read
    # their report from it after the process ended).
    _finished_buffers[terminal_id] = _terminal_buffers.pop(terminal_id, "")
    while len(_finished_buffers) > 12:
        _finished_buffers.pop(next(iter(_finished_buffers)))
    try:
        window.evaluate_js(f"window.__devhub_onTerminalExit && window.__devhub_onTerminalExit({json.dumps(terminal_id)})")
    except Exception:
        pass


def cli_binary(provider=None):
    """The interactive CLI of an agent from Paramètres IA (bare binary, flags
    dropped) — the default agent when `provider` is None."""
    cli_command = (ai_cli_command(load_config().get("ai", {}), provider) or "").strip()
    if not cli_command:
        return None
    try:
        return shlex.split(cli_command, posix=False)[0].strip('"')
    except (ValueError, IndexError):
        return None


def cli_kind(binary=None):
    """'claude', 'codex' or 'other': which session store / resume syntax applies."""
    name = Path(binary or cli_binary() or "").stem.lower()
    return name if name in ("claude", "codex") else "other"


CLI_LABELS = {"claude": "Claude", "codex": "Codex", "other": "l'IA"}

# rollout file -> (mtime, cwd, id, title): a project's list re-reads only
# sessions that changed since last time.
_codex_cache = {}


def _codex_title(text):
    text = " ".join((text or "").strip().split())
    # Codex injects context blocks (<environment_context>…) as user messages.
    if len(text) < 2 or text.startswith("<"):
        return None
    return text[:80]


def _codex_meta(f):
    mtime = f.stat().st_mtime
    cached = _codex_cache.get(f)
    if cached and cached[0] == mtime:
        return cached[1:]
    cwd = sid = title = None
    try:
        with f.open("r", encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                if i >= 200 or (cwd and title):
                    break
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                payload = obj.get("payload") or {}
                if obj.get("type") == "session_meta":
                    cwd, sid = payload.get("cwd"), payload.get("id")
                elif obj.get("type") == "response_item" and payload.get("role") == "user" and not title:
                    for block in payload.get("content") or []:
                        if isinstance(block, dict) and block.get("type") == "input_text":
                            title = _codex_title(block.get("text"))
                            if title:
                                break
    except OSError:
        pass
    _codex_cache[f] = (mtime, cwd, sid, title)
    return cwd, sid, title


def _norm(path):
    path = str(path or "")
    # Codex stores Windows paths in extended form (\\?\C:\...), which would never
    # equal the plain path of a project.
    if path.startswith("\\\\?\\UNC\\"):
        path = "\\\\" + path[8:]
    elif path.startswith("\\\\?\\"):
        path = path[4:]
    try:
        return os.path.normcase(str(Path(path).resolve()))
    except OSError:
        return os.path.normcase(path)


CODEX_HOME = Path.home() / ".codex"


def codex_state_db():
    """Codex's thread database (state_<n>.sqlite, the highest n). Recent versions
    keep every session there and prune the rollout files, so reading the files
    alone shows almost nothing."""
    try:
        found = sorted(CODEX_HOME.glob("state_*.sqlite"), key=lambda p: int("".join(c for c in p.stem if c.isdigit()) or 0))
    except OSError:
        return None
    return found[-1] if found else None


def open_codex_db(path):
    """Read-only connection (never writes to Codex's files)."""
    import sqlite3

    for flags in ("mode=ro", "mode=ro&immutable=1"):
        try:
            con = sqlite3.connect(f"file:{Path(path).as_posix()}?{flags}", uri=True, timeout=2)
            con.execute("select 1 from sqlite_master limit 1")
            return con
        except sqlite3.Error:
            continue
    return None


def _clean_codex_title(name, title, preview, first):
    for candidate in (name,):
        if candidate and candidate.strip() and candidate.strip().lower() != "guardian review":
            return " ".join(candidate.split())[:80]
    text = first or preview or title or ""
    marker = "## My request for Codex:"
    if marker in text:
        text = text.split(marker, 1)[1]
    elif text.lstrip().startswith("# Files mentioned"):
        return "Session avec fichiers joints"
    text = " ".join(text.split())
    return text[:80] if len(text) >= 2 else None


def _codex_db_sessions(target):
    db = codex_state_db()
    if not db:
        return []
    con = open_codex_db(db)
    if con is None:
        return []
    out = []
    try:
        rows = con.execute(
            "select id, name, title, preview, first_user_message, coalesce(updated_at_ms, updated_at * 1000), cwd, source "
            "from threads where archived = 0"
        ).fetchall()
    except Exception:
        rows = []
    finally:
        con.close()
    for sid, name, title, preview, first, updated, cwd, source in rows:
        src = str(source or "")
        # Sub-agent reviews and `codex exec` one-shots (commit messages…) are not
        # conversations anyone resumes.
        if "subagent" in src or src == "exec":
            continue
        if not cwd or _norm(cwd) != target:
            continue
        out.append({"id": sid, "title": _clean_codex_title(name, title, preview, first) or "Session sans titre", "modified": (updated or 0) / 1000})
    return out


def list_codex_sessions(path):
    target = _norm(path)
    sessions = {s["id"]: s for s in _codex_db_sessions(target)}
    root = CODEX_HOME / "sessions"
    if root.exists():
        for f in root.rglob("rollout-*.jsonl"):
            cwd, sid, title = _codex_meta(f)
            if cwd and sid and sid not in sessions and _norm(cwd) == target:
                sessions[sid] = {"id": sid, "title": title or "Session sans titre", "modified": f.stat().st_mtime}
    return sorted(sessions.values(), key=lambda s: s["modified"], reverse=True)


def _claude_project_dir(path):
    normalized = str(Path(path).resolve())
    encoded = re.sub(r"[\\/:]", "-", normalized)
    return Path.home() / ".claude" / "projects" / encoded


class TerminalMixin:
    def get_ai_cli(self):
        """Which CLI the IA tab drives, so the UI can say Claude or Codex."""
        kind = cli_kind()
        return {"kind": kind, "label": CLI_LABELS[kind], "configured": cli_binary() is not None}

    def get_ai_agents(self):
        """Every CLI agent with its command and whether its binary exists, for
        the Claude/Codex pickers and the Paramètres IA page."""
        ai = load_config().get("ai", {})
        commands = ai_cli_commands(ai)
        default = default_agent(ai)
        agents = []
        for provider in AGENT_PROVIDERS:
            binary = cli_binary(provider)
            installed = bool(binary and (shutil.which(binary) or Path(binary).exists()))
            agents.append(
                {
                    "id": provider,
                    "kind": cli_kind(binary) if binary else "other",
                    "command": commands[provider],
                    "installed": installed,
                    "default": provider == default,
                }
            )
        return {"agents": agents, "default": default, "commit_provider": ai.get("provider")}

    def list_claude_sessions(self, path, provider=None):
        # Name kept for the existing callers: lists the sessions of the given
        # CLI (default agent when None) — Claude Code or Codex.
        kind = cli_kind(cli_binary(provider))
        if kind == "codex":
            return list_codex_sessions(path)
        if kind == "other":
            return []
        project_dir = _claude_project_dir(path)
        if not project_dir.exists():
            return []

        sessions = []
        for f in project_dir.glob("*.jsonl"):
            title = None
            fallback = None
            try:
                with f.open("r", encoding="utf-8", errors="replace") as fh:
                    for i, line in enumerate(fh):
                        if i >= 80:
                            break
                        try:
                            obj = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if obj.get("type") == "ai-title":
                            title = obj.get("aiTitle")
                            break
                        if not fallback and obj.get("type") == "user":
                            content = (obj.get("message") or {}).get("content")
                            text = None
                            if isinstance(content, str):
                                text = content
                            elif isinstance(content, list):
                                for block in content:
                                    if isinstance(block, dict) and block.get("type") == "text":
                                        text = block.get("text")
                                        break
                            if text:
                                fallback = " ".join(text.strip().split())[:80]
            except Exception:
                pass
            sessions.append(
                {
                    "id": f.stem,
                    "title": title or fallback or "Session sans titre",
                    "modified": f.stat().st_mtime,
                }
            )
        sessions.sort(key=lambda s: s["modified"], reverse=True)
        return sessions

    def start_terminal(self, path, session_id=None, prompt=None, rows=24, cols=80, provider=None):
        # cli_command is tuned for the one-shot commit-message call (e.g. "claude -p")
        # and its flags (-p/exec/...) are incompatible with an interactive session —
        # only the bare binary should be launched here. `provider` picks which
        # agent (Claude/Codex); None = the default one.
        binary = cli_binary(provider)
        if not binary:
            return {"error": "Commande CLI non configurée ou invalide (voir Paramètres IA)"}

        argv = [binary]
        if session_id:
            # claude --resume <id> / codex resume <id>
            argv += ["resume", session_id] if cli_kind(binary) == "codex" else ["--resume", session_id]
        # A Hubi task: sent as the session's first message — both CLIs take
        # a trailing prompt ([--resume id | resume id] "<prompt>").
        prompt = " ".join(str(prompt or "").split())
        if prompt:
            argv.append(prompt)

        # DevHub.exe is a frozen GUI app with no console, so it inherits no
        # TERM/color env vars at all — CLIs that auto-detect color support
        # (chalk, supports-color, etc.) see that absence and quietly
        # disable their own theming for anything not hardcoded, which is
        # why only the static banner stayed colored and everything else
        # went plain. Forcing these makes the CLI trust it has full color.
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["FORCE_COLOR"] = "1"

        # Claude Code draws a full-screen TUI as soon as it starts.  Starting
        # it at the historical 80x24 fallback and resizing it a moment later
        # leaves its first layout (input box, separators and status row) out
        # of sync with xterm.  The browser now gives us its fitted dimensions
        # before spawning the process, so its first draw matches the visible
        # terminal just like Windows Terminal does.
        try:
            rows = max(2, min(int(rows), 500))
            cols = max(20, min(int(cols), 1000))
        except (TypeError, ValueError):
            rows, cols = 24, 80
        try:
            proc = platform_svc.spawn_pty(argv, path, env, rows, cols)
        except Exception as e:
            return {"error": str(e)}

        terminal_id = str(uuid.uuid4())
        register(terminal_id, proc)
        threading.Thread(target=stream_terminal, args=(terminal_id, proc), daemon=True).start()
        return {"ok": True, "terminal_id": terminal_id}

    def get_terminal_buffer(self, terminal_id):
        return get_buffer(terminal_id)

    def clear_run_buffer(self, terminal_id):
        pop_buffer(terminal_id)
        return {"ok": True}

    def write_terminal(self, terminal_id, data):
        proc = get(terminal_id)
        if not proc:
            return {"error": "Session introuvable"}
        try:
            proc.write(data)
        except Exception as e:
            return {"error": str(e)}
        return {"ok": True}

    def resize_terminal(self, terminal_id, rows, cols):
        proc = get(terminal_id)
        if not proc:
            return {"error": "Session introuvable"}
        try:
            proc.setwinsize(rows, cols)
        except Exception as e:
            return {"error": str(e)}
        return {"ok": True}

    def start_shell(self, path, kind="powershell", rows=24, cols=80):
        """An interactive shell (PowerShell, CMD, Git Bash…) in a PTY, for the
        terminal panel of the Code tab. Same plumbing as the AI sessions: the
        page writes with write_terminal and reads what stream_terminal pushes."""
        import sys

        if not path or not Path(path).is_dir():
            return {"error": "Dossier introuvable"}
        if sys.platform == "win32":
            if kind == "bash":
                launcher = getattr(platform_svc, "_git_bash_launcher", lambda: None)()
                bash = Path(launcher).parent / "bin" / "bash.exe" if launcher else None
                if not bash or not bash.exists():
                    return {"error": "Git Bash introuvable"}
                argv = [str(bash), "--login", "-i"]
            elif kind == "cmd":
                argv = ["cmd.exe"]
            else:
                argv = ["powershell.exe", "-NoLogo"]
        else:
            argv = [os.environ.get("SHELL") or "/bin/bash"]
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        try:
            rows = max(2, min(int(rows), 500))
            cols = max(20, min(int(cols), 1000))
        except (TypeError, ValueError):
            rows, cols = 24, 80
        try:
            proc = platform_svc.spawn_pty(argv, path, env, rows, cols)
        except Exception as e:
            return {"error": str(e)}
        terminal_id = str(uuid.uuid4())
        register(terminal_id, proc)
        threading.Thread(target=stream_terminal, args=(terminal_id, proc), daemon=True).start()
        return {"ok": True, "terminal_id": terminal_id}

    def close_terminal(self, terminal_id):
        proc = pop(terminal_id)
        if proc:
            try:
                proc.close(force=True)
            except Exception:
                pass
        return {"ok": True}

import json
import os
import re
import shlex
import threading
import uuid
from pathlib import Path

import webview

from app_config import load_config
from core.platform import platform_svc

# _terminals/_terminal_buffers are the single shared source of truth for
# every PTY session Dev Hub owns (the interactive AI terminal here, and the
# run-config terminals in features/processes/run_configs.py) — anything
# outside this module reaches them only through the functions below, never
# by importing the dicts directly.
_terminals = {}
_terminal_buffers = {}
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
    _terminal_buffers.pop(terminal_id, None)
    try:
        window.evaluate_js(f"window.__devhub_onTerminalExit && window.__devhub_onTerminalExit({json.dumps(terminal_id)})")
    except Exception:
        pass


def _claude_project_dir(path):
    normalized = str(Path(path).resolve())
    encoded = re.sub(r"[\\/:]", "-", normalized)
    return Path.home() / ".claude" / "projects" / encoded


class TerminalMixin:
    def list_claude_sessions(self, path):
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

    def start_terminal(self, path, session_id=None):
        ai = load_config().get("ai", {})
        cli_command = (ai.get("cli_command") or "").strip()
        if not cli_command:
            return {"error": "Commande CLI non configurée (voir Paramètres IA)"}

        # cli_command is tuned for the one-shot commit-message call (e.g. "claude -p")
        # and its flags (-p/exec/...) are incompatible with an interactive session —
        # only the bare binary should be launched here.
        try:
            binary = shlex.split(cli_command, posix=False)[0]
        except (ValueError, IndexError):
            return {"error": "Commande CLI invalide"}

        argv = [binary]
        if session_id:
            argv += ["--resume", session_id]

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

        try:
            proc = platform_svc.spawn_pty(argv, path, env, 24, 80)
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

    def close_terminal(self, terminal_id):
        proc = pop(terminal_id)
        if proc:
            try:
                proc.close(force=True)
            except Exception:
                pass
        return {"ok": True}

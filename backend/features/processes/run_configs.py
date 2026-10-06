import json
import os
import threading
import uuid

import webview

from app_config import load_config, save_config
from core.platform import platform_svc
from features.terminal import sessions as terminal_sessions

# Running-config tracker: one entry per (repo path, config name) currently
# executing. Lives here (not in features/terminal) because it's run-config
# specific state, not generic terminal state -- but the PTY processes
# themselves and their output buffers are still owned solely by
# features/terminal/sessions.py.
_running = {}


def _run_key(path, name):
    # NUL can never appear in a real path or config name, so it's a safe
    # separator for composite keys — lets the same project run several
    # configs at once instead of one run clobbering the whole project's slot.
    return f"{path}\x00{name}"


def all_running():
    return _running


def _stream_run_terminal(path, name, terminal_id, proc):
    window = webview.windows[0]
    try:
        while proc.isalive():
            try:
                data = proc.read(4096)
            except EOFError:
                break
            if data:
                terminal_sessions.append_buffer(terminal_id, data)
                try:
                    window.evaluate_js(
                        f"window.__devhub_onTerminalData && window.__devhub_onTerminalData({json.dumps(terminal_id)}, {json.dumps(data)})"
                    )
                except Exception:
                    pass
    except Exception:
        pass
    terminal_sessions.pop(terminal_id)
    # Keep _terminal_buffers around after exit so the user can still read the
    # error/output that just happened — only an explicit "Clear" wipes it.
    _running.pop(_run_key(path, name), None)
    try:
        window.evaluate_js(f"window.__devhub_onTerminalExit && window.__devhub_onTerminalExit({json.dumps(terminal_id)})")
        window.evaluate_js(
            f"window.__devhub_onRunExit && window.__devhub_onRunExit({json.dumps(path)}, {json.dumps(name)}, 0)"
        )
    except Exception:
        pass


class ProcessesRunMixin:
    def list_run_configs(self, path):
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        return repo.get("runs", []) if repo else []

    def save_run_config(self, path, name, command, env=None, url=None, shell=None):
        name = (name or "").strip()
        command = (command or "").strip()
        if not name or not command:
            return {"error": "Nom et commande requis"}
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        if not repo:
            return {"error": "Repo introuvable"}
        repo.setdefault("runs", [])
        entry = {
            "name": name,
            "command": command,
            "env": env or {},
            "url": (url or "").strip(),
            "shell": shell if shell in ("cmd", "powershell") else "cmd",
        }
        existing = next((r for r in repo["runs"] if r["name"] == name), None)
        if existing:
            existing.update(entry)
        else:
            # The first command added for a project becomes its default —
            # the one "Lancer le groupe" uses — until the user picks another.
            entry["default"] = len(repo["runs"]) == 0
            repo["runs"].append(entry)
        save_config(config)
        return {"ok": True}

    def set_default_run_config(self, path, name):
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        if not repo:
            return {"error": "Projet introuvable"}
        found = False
        for c in repo.get("runs", []):
            c["default"] = c["name"] == name
            found = found or c["default"]
        if not found:
            return {"error": "Commande introuvable"}
        save_config(config)
        return {"ok": True}

    def delete_run_config(self, path, name):
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        if repo:
            was_default = any(r["name"] == name and r.get("default") for r in repo.get("runs", []))
            repo["runs"] = [r for r in repo.get("runs", []) if r["name"] != name]
            # Deleting the default command leaves another one as the new
            # default so "Lancer le groupe" doesn't silently drop this project.
            if was_default and repo["runs"]:
                repo["runs"][0]["default"] = True
            save_config(config)
        return {"ok": True}

    def run_status(self, path, name):
        entry = _running.get(_run_key(path, name))
        return {"running": entry is not None, "config": entry["config"] if entry else None}

    def start_run(self, path, name):
        key = _run_key(path, name)
        if key in _running:
            return {"error": "Déjà en cours d'exécution"}
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        run_cfg = next((r for r in (repo.get("runs", []) if repo else []) if r["name"] == name), None)
        if not run_cfg:
            return {"error": "Configuration introuvable"}

        env = os.environ.copy()
        env.update(run_cfg.get("env") or {})

        try:
            # cmd /c or powershell -Command (not an interactive shell we
            # then type into) so the pty's lifetime tracks the actual
            # command: Ctrl+C-ing the dev server ends the whole session
            # instead of leaving a live empty shell behind that still
            # looks "running" to the rest of the app. Picking the wrong
            # one silently breaks commands written for the other — cmd
            # doesn't split on ";" or know PowerShell cmdlets like
            # Copy-Item, and older Windows PowerShell (5.1) doesn't
            # understand "&&" the way cmd/pwsh 7 do — so this is a
            # per-command choice, not something to guess from the text.
            if run_cfg.get("shell") == "powershell":
                argv = ["powershell.exe", "-NoLogo", "-NoProfile", "-Command", run_cfg["command"]]
            else:
                argv = ["cmd.exe", "/c", run_cfg["command"]]
            proc = platform_svc.spawn_pty(argv, path, env, 24, 80)
        except Exception as e:
            return {"error": str(e)}

        terminal_id = str(uuid.uuid4())
        terminal_sessions.register(terminal_id, proc)
        _running[key] = {"terminal_id": terminal_id, "config": name, "path": path}
        threading.Thread(target=_stream_run_terminal, args=(path, name, terminal_id, proc), daemon=True).start()
        return {"ok": True, "terminal_id": terminal_id}

    def stop_run(self, path, name):
        entry = _running.get(_run_key(path, name))
        if not entry:
            return {"error": "Rien en cours"}
        proc = terminal_sessions.get(entry.get("terminal_id"))
        if proc:
            # cmd.exe spawns the real dev server (npm -> node, etc.) as a
            # child; closing just the pty leaves that child running as an
            # orphan. Killing the whole process tree by pid stops it too.
            platform_svc.kill_process_tree(proc.pid)
            try:
                proc.close(force=True)
            except Exception:
                pass
        return {"ok": True}

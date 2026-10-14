"""Install / remove Hubi's Claude Code hooks in ~/.claude/settings.json.

Only our own entries are ever touched: they are recognized by MARKER in
their command, appended as separate matcher groups next to the user's own
hooks, and removed exactly. Everything else in the file is written back as is.
"""
import json
import shutil
from pathlib import Path

from . import channel

MARKER = "hubi-notify"
EVENTS = ("UserPromptSubmit", "Notification", "Stop", "StopFailure", "SessionEnd")
BACKUP_SUFFIX = ".devhub-backup"


def settings_path():
    return Path.home() / ".claude" / "settings.json"


def build_command(token, port=channel.PORT):
    # Claude Code runs hooks through Git Bash (or PowerShell when Git Bash is
    # missing): this line parses the same way in both. curl.exe ships with
    # Windows; "; exit 0" keeps the hook a success even when Hubi is down,
    # and Hubi answers 204 so nothing lands in Claude's context. A refused
    # loopback connect takes ~2 s on Windows, hence the short connect timeout.
    return (
        f'curl.exe -s --connect-timeout 0.5 -m 2 -X POST -H "Content-Type: application/json" --data-binary "@-" '
        f'"http://127.0.0.1:{port}/claude?token={token}"; exit 0 # {MARKER}'
    )


def _hook_entry(command):
    # Not "async": Claude Code may exit before an async Stop hook has run.
    return {"type": "command", "command": command}


def _is_ours(hook):
    return isinstance(hook, dict) and MARKER in str(hook.get("command", ""))


def _read(path):
    """(data, raw text) — raw None if the file doesn't exist. Raises on
    invalid JSON so a file we can't parse is never overwritten."""
    if not path.exists():
        return {}, None
    with open(path, encoding="utf-8-sig", newline="") as f:
        raw = f.read()
    data = json.loads(raw) if raw.strip() else {}
    if not isinstance(data, dict):
        raise ValueError("settings.json n'est pas un objet JSON")
    return data, raw


def _write(path, data, raw):
    text = json.dumps(data, indent=2, ensure_ascii=False)
    if raw is None or raw.endswith("\n"):
        text += "\n"
    if raw is not None and "\r\n" in raw:
        text = text.replace("\n", "\r\n")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def _strip_ours(data):
    """Remove our hooks. A matcher group goes only if it held nothing but
    ours; an event list / the "hooks" object only if we emptied it."""
    hooks = data.get("hooks")
    if not isinstance(hooks, dict):
        return False
    changed = False
    for event in list(hooks):
        groups = hooks[event]
        if not isinstance(groups, list):
            continue
        kept = []
        touched = False
        for group in groups:
            inner = group.get("hooks") if isinstance(group, dict) else None
            if not isinstance(inner, list) or not any(_is_ours(h) for h in inner):
                kept.append(group)
                continue
            touched = True
            rest = [h for h in inner if not _is_ours(h)]
            if rest:
                kept.append({**group, "hooks": rest})
        if touched:
            changed = True
            if kept:
                hooks[event] = kept
            else:
                del hooks[event]
    if changed and not hooks:
        del data["hooks"]
    return changed


def is_enabled(token, path=None):
    path = path or settings_path()
    try:
        data, _ = _read(path)
    except Exception:
        return False
    hooks = data.get("hooks")
    if not isinstance(hooks, dict):
        return False
    command = build_command(token)
    for event in EVENTS:
        groups = hooks.get(event)
        if not isinstance(groups, list):
            return False
        found = any(
            isinstance(g, dict)
            and any(isinstance(h, dict) and h.get("command") == command for h in (g.get("hooks") or []))
            for g in groups
        )
        if not found:
            return False
    return True


def installed(path=None):
    """Any of our hook entries present, whatever token they carry."""
    path = path or settings_path()
    try:
        data, _ = _read(path)
    except Exception:
        return False
    hooks = data.get("hooks")
    if not isinstance(hooks, dict):
        return False
    return any(
        isinstance(g, dict) and any(_is_ours(h) for h in (g.get("hooks") or []))
        for groups in hooks.values()
        if isinstance(groups, list)
        for g in groups
    )


def resync(token, path=None):
    """Hooks installed with an older token (or port) are rejected by Hubi's
    server, silently: rewrite them with the current one. True if rewritten."""
    if installed(path) and not is_enabled(token, path):
        enable(token, path)
        return True
    return False


def enable(token, path=None):
    path = path or settings_path()
    data, raw = _read(path)
    hooks = data.get("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError('"hooks" n\'est pas un objet dans settings.json')
    backup = path.with_name(path.name + BACKUP_SUFFIX)
    if raw is not None and not backup.exists():
        shutil.copy2(path, backup)
    _strip_ours(data)
    hooks = data.setdefault("hooks", {})
    command = build_command(token)
    for event in EVENTS:
        groups = hooks.setdefault(event, [])
        if not isinstance(groups, list):
            raise ValueError(f'"hooks.{event}" n\'est pas une liste dans settings.json')
        groups.append({"matcher": "", "hooks": [_hook_entry(command)]})
    _write(path, data, raw)


def disable(path=None):
    path = path or settings_path()
    if not path.exists():
        return
    data, raw = _read(path)
    if _strip_ours(data):
        _write(path, data, raw)

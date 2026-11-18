"""Helpers behind the composer bar of Claude/Codex sessions: the list of
slash commands / skills the agent knows, and a place to drop pasted images so
their path can be handed to the CLI."""

import base64
import re
import tempfile
import time
import uuid
from pathlib import Path

from .sessions import cli_binary, cli_kind

# What each CLI ships with. Only commands that exist in the interactive TUI.
_BUILTIN = {
    "claude": [
        ("/compact", "Résumer la conversation pour libérer du contexte"),
        ("/clear", "Repartir d'une conversation vide"),
        ("/rewind", "Revenir à un point précédent (conversation et/ou fichiers)"),
        ("/model", "Changer de modèle"),
        ("/effort", "Régler le niveau de réflexion"),
        ("/resume", "Reprendre une autre session"),
        ("/context", "Voir l'utilisation du contexte"),
        ("/cost", "Voir la consommation"),
        ("/init", "Créer un CLAUDE.md pour ce projet"),
        ("/review", "Relire les changements"),
        ("/memory", "Modifier les fichiers mémoire"),
        ("/mcp", "Gérer les serveurs MCP"),
        ("/permissions", "Gérer les permissions"),
        ("/status", "Afficher l'état de la session"),
        ("/help", "Aide"),
    ],
    "codex": [
        ("/model", "Choisir le modèle et le niveau de réflexion"),
        ("/approvals", "Choisir ce que Codex peut faire sans demander"),
        ("/review", "Relire les changements"),
        ("/new", "Démarrer une nouvelle conversation"),
        ("/init", "Créer un AGENTS.md"),
        ("/compact", "Résumer la conversation"),
        ("/diff", "Afficher le diff git"),
        ("/mention", "Mentionner un fichier"),
        ("/status", "Afficher l'état de la session"),
    ],
}

_ATTACH_EXT = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "pdf", "txt", "md", "json", "csv", "log"}
_MAX_ATTACH = 25 * 1024 * 1024


def _description(text):
    """First `description:` of a markdown front matter, on one line."""
    head = text[:4000]
    m = re.search(r"^description:\s*(.*)$", head, re.MULTILINE)
    if not m:
        return ""
    value = m.group(1).strip().strip("\"'")
    if value in (">", "|", ">-", "|-"):
        after = head[m.end():].lstrip("\n")
        first = after.split("\n", 1)[0].strip()
        value = first
    return value[:160]


def _read(path):
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _skills_in(root, scope, prefix, sep=""):
    """<root>/<name>/SKILL.md entries."""
    out = []
    if not root.is_dir():
        return out
    for d in sorted(root.iterdir()):
        skill = d / "SKILL.md"
        if d.is_dir() and skill.is_file():
            out.append(
                {
                    "name": d.name,
                    "command": f"{prefix}{d.name}",
                    "description": _description(_read(skill)),
                    "scope": scope,
                    "kind": "skill",
                }
            )
    return out


def _commands_in(root, scope, prefix):
    """<root>/**/*.md custom commands (sub-folders become `folder:name`)."""
    out = []
    if not root.is_dir():
        return out
    for f in sorted(root.rglob("*.md")):
        rel = f.relative_to(root).with_suffix("")
        name = ":".join(rel.parts)
        out.append(
            {
                "name": name,
                "command": f"{prefix}{name}",
                "description": _description(_read(f)),
                "scope": scope,
                "kind": "command",
            }
        )
    return out


class ComposerMixin:
    def list_ai_commands(self, path, provider=None):
        """Slash commands and skills available to the agent in this repo."""
        kind = cli_kind(cli_binary(provider))
        home = Path.home()
        repo = Path(path) if path else None
        items = []
        if kind == "claude":
            if repo:
                items += _skills_in(repo / ".claude" / "skills", "project", "/")
                items += _commands_in(repo / ".claude" / "commands", "project", "/")
            items += _skills_in(home / ".claude" / "skills", "user", "/")
            items += _commands_in(home / ".claude" / "commands", "user", "/")
        elif kind == "codex":
            items += _skills_in(home / ".codex" / "skills", "user", "$")
            items += _commands_in(home / ".codex" / "prompts", "user", "/prompts:")
        seen = set()
        unique = []
        for it in items:  # project entries come first and win over user ones
            if it["command"] in seen:
                continue
            seen.add(it["command"])
            unique.append(it)
        for command, description in _BUILTIN.get(kind, []):
            unique.append(
                {"name": command.lstrip("/"), "command": command, "description": description, "scope": "built-in", "kind": "builtin"}
            )
        return {"kind": kind, "items": unique}

    def save_ai_attachment(self, data_base64, ext="png"):
        """Store a pasted / picked file in a temp folder and return its path,
        which gets typed into the agent's prompt (both CLIs read `@path`)."""
        ext = re.sub(r"[^a-z0-9]", "", str(ext or "png").lower()) or "png"
        if ext not in _ATTACH_EXT:
            return {"error": f"Type de fichier non pris en charge (.{ext})"}
        try:
            raw = base64.b64decode(str(data_base64).split(",", 1)[-1], validate=False)
        except Exception:
            return {"error": "Fichier illisible"}
        if not raw:
            return {"error": "Fichier vide"}
        if len(raw) > _MAX_ATTACH:
            return {"error": "Fichier trop gros (25 Mo max)"}
        folder = Path(tempfile.gettempdir()) / "devhub-attachments"
        folder.mkdir(parents=True, exist_ok=True)
        cutoff = time.time() - 7 * 86400
        for old in folder.iterdir():  # attachments are throwaway: drop week-old ones
            try:
                if old.is_file() and old.stat().st_mtime < cutoff:
                    old.unlink()
            except OSError:
                pass
        target = folder / f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}.{ext}"
        target.write_bytes(raw)
        return {"ok": True, "path": str(target), "name": target.name}

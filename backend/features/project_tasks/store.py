"""The "Tâches" tab: a small task list and free notes per project (kept in Dev Hub's
data folder, never in the repo), plus a scan of the TODO / FIXME comments in the code."""

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

from app_config import APP_DATA_DIR

STORE_DIR = APP_DATA_DIR / "tasks"
SKIP_DIRS = {".git", "node_modules", "dist", "build", "target", ".venv", "venv", "__pycache__", ".next", ".gradle", ".idea", "out", "coverage", "vendor"}
TEXT_EXT = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".java", ".kt", ".kts", ".go", ".rs", ".rb", ".php", ".cs", ".c", ".h", ".cpp", ".hpp",
    ".swift", ".vue", ".svelte", ".css", ".scss", ".html", ".sql", ".sh", ".yml", ".yaml", ".toml", ".gradle", ".xml", ".md", ".properties",
}
_TODO = re.compile(r"(?://|#|/\*|<!--|--|;|\*)\s*(TODO|FIXME|HACK|XXX|BUG)\b(?:\([^)]*\))?[\s:\-]*(.*)", re.I)
MAX_FILE = 400_000
MAX_HITS = 400
_KIND_ORDER = {"FIXME": 0, "BUG": 0, "HACK": 1, "XXX": 1, "TODO": 2}


def _path(repo_path):
    key = hashlib.sha1(str(Path(repo_path).resolve()).lower().encode("utf-8")).hexdigest()[:16]
    return STORE_DIR / f"{key}.json"


def load(repo_path):
    try:
        data = json.loads(_path(repo_path).read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return {"tasks": data.get("tasks") or [], "notes": data.get("notes") or ""}
    except (OSError, ValueError):
        pass
    return {"tasks": [], "notes": ""}


def save(repo_path, data):
    if not isinstance(data, dict):
        return {"error": "Format invalide"}
    clean = {
        "tasks": [t for t in (data.get("tasks") or []) if isinstance(t, dict)][:1000],
        "notes": str(data.get("notes") or "")[:500_000],
    }
    try:
        STORE_DIR.mkdir(parents=True, exist_ok=True)
        _path(repo_path).write_text(json.dumps(clean, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError as e:
        return {"error": str(e)}
    return {"ok": True}


def _files(base):
    """Tracked files when the folder is a git repo (fast, respects .gitignore), else a walk."""
    try:
        out = subprocess.run(
            ["git", "-C", str(base), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            capture_output=True, timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if out.returncode == 0 and out.stdout:
            for rel in out.stdout.decode("utf-8", errors="replace").split("\0"):
                if rel:
                    yield rel
            return
    except (OSError, subprocess.SubprocessError):
        pass
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            yield os.path.relpath(os.path.join(root, f), base).replace("\\", "/")


def scan_todos(repo_path):
    base = Path(repo_path)
    if not base.is_dir():
        return {"error": "Dossier introuvable"}
    hits = []
    for rel in _files(base):
        parts = rel.split("/")
        if any(p in SKIP_DIRS for p in parts[:-1]) or Path(rel).suffix.lower() not in TEXT_EXT:
            continue
        f = base / rel
        try:
            if not f.is_file() or f.stat().st_size > MAX_FILE:
                continue
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if "todo" not in text.lower() and "fixme" not in text.lower() and "hack" not in text.lower() and "xxx" not in text.lower() and "bug" not in text.lower():
            continue
        for n, line in enumerate(text.split("\n"), 1):
            m = _TODO.search(line)
            if m:
                msg = m.group(2).strip().rstrip("*/").rstrip("-->").strip()
                hits.append({"file": rel, "line": n, "kind": m.group(1).upper(), "text": msg[:200]})
                if len(hits) >= MAX_HITS:
                    break
        if len(hits) >= MAX_HITS:
            break
    hits.sort(key=lambda h: (_KIND_ORDER.get(h["kind"], 3), h["file"], h["line"]))
    return {"items": hits, "truncated": len(hits) >= MAX_HITS}

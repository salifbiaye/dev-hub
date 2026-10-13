"""Tasks shared by Dev Hub and Hubi: APP_DATA_DIR/hubi_tasks.json, a list of
{id, text, project (repo path or None), done, created_at}."""
import json
import threading
import time
import uuid

from app_config import APP_DATA_DIR

TASKS_FILE = APP_DATA_DIR / "hubi_tasks.json"
MAX_TEXT = 300

_lock = threading.Lock()


def _load():
    try:
        data = json.loads(TASKS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return [t for t in data if isinstance(t, dict) and isinstance(t.get("id"), str)]


def _save(items):
    TASKS_FILE.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")


def list_tasks():
    with _lock:
        return _load()


def open_tasks():
    return [t for t in list_tasks() if not t.get("done")]


def add(text, project=None):
    text = " ".join(str(text or "").split())[:MAX_TEXT]
    if not text:
        return None
    task = {
        "id": uuid.uuid4().hex[:12],
        "text": text,
        "project": project if isinstance(project, str) and project else None,
        "done": False,
        "created_at": int(time.time()),
    }
    with _lock:
        items = _load()
        items.append(task)
        _save(items)
    return task


def toggle(task_id):
    with _lock:
        items = _load()
        for t in items:
            if t["id"] == task_id:
                t["done"] = not t.get("done")
                _save(items)
                return t
    return None


def delete(task_id):
    with _lock:
        items = _load()
        kept = [t for t in items if t["id"] != task_id]
        if len(kept) == len(items):
            return False
        _save(kept)
    return True


def set_project(task_id, project):
    with _lock:
        items = _load()
        for t in items:
            if t["id"] == task_id:
                t["project"] = project if isinstance(project, str) and project else None
                _save(items)
                return t
    return None


def split_project_prefix(text):
    """"@projet-front corriger le login" -> (repo path, "corriger le login").
    Matches a Dev Hub project by folder name, case-insensitively."""
    from pathlib import Path

    from app_config import load_config

    text = (text or "").strip()
    if not text.startswith("@"):
        return None, text
    token, _, rest = text[1:].partition(" ")
    token = token.lower()
    for repo in load_config().get("repos", []):
        path = repo.get("path") or ""
        if token and Path(path).name.lower() == token:
            return path, rest.strip()
    return None, text

"""Import / export of request collections: Postman v2.1 and Insomnia v4 (JSON) in,
Postman v2.1 out (Insomnia, Bruno, Hoppscotch… all read it). Requests keep their
folder as a "A/B" path in `folder`."""

import json
import re
import uuid
from pathlib import Path

import webview

POSTMAN_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"


def _id():
    return uuid.uuid4().hex[:8]


def _req(name, method, url, headers, body, bearer, folder):
    return {
        "id": _id(),
        "name": name or f"{method} {url}",
        "method": (method or "GET").upper(),
        "url": url or "/",
        "params": [],
        "headers": headers,
        "body": body or "",
        "bearer": bearer or "",
        "folder": folder,
    }


# ------------------------------------------------------------------ Postman in

def _pm_url(u):
    if isinstance(u, str):
        return u
    if isinstance(u, dict):
        raw = u.get("raw")
        if raw:
            return raw
        host = ".".join(u.get("host") or []) if isinstance(u.get("host"), list) else u.get("host") or ""
        path = "/".join(u.get("path") or []) if isinstance(u.get("path"), list) else u.get("path") or ""
        return f"{host}/{path}".strip("/")
    return ""


def _pm_bearer(auth):
    if isinstance(auth, dict) and auth.get("type") == "bearer":
        for p in auth.get("bearer") or []:
            if p.get("key") == "token":
                return str(p.get("value") or "")
    return ""


def _pm_walk(items, folder, inherited, out):
    for it in items or []:
        if not isinstance(it, dict):
            continue
        if "item" in it:
            sub = "/".join(x for x in (folder, str(it.get("name") or "").strip()) if x)
            _pm_walk(it["item"], sub, _pm_bearer(it.get("auth")) or inherited, out)
            continue
        r = it.get("request")
        if isinstance(r, str):
            r = {"method": "GET", "url": r}
        if not isinstance(r, dict):
            continue
        headers = [
            {"key": h.get("key", ""), "value": str(h.get("value", "")), "enabled": not h.get("disabled")}
            for h in (r.get("header") or [])
            if isinstance(h, dict)
        ]
        body = ""
        b = r.get("body")
        if isinstance(b, dict):
            if b.get("mode") == "raw":
                body = b.get("raw") or ""
            elif b.get("mode") == "urlencoded":
                body = "&".join(f"{p.get('key')}={p.get('value', '')}" for p in b.get("urlencoded") or [] if not p.get("disabled"))
        bearer = _pm_bearer(r.get("auth")) or inherited
        out.append(_req(it.get("name"), r.get("method"), _pm_url(r.get("url")), headers, body, bearer, folder))


def _from_postman(data):
    out = []
    _pm_walk(data.get("item"), "", _pm_bearer(data.get("auth")), out)
    variables = [
        {"key": v.get("key"), "value": str(v.get("value", "")), "enabled": not v.get("disabled")}
        for v in data.get("variable") or []
        if isinstance(v, dict) and v.get("key")
    ]
    return {"name": (data.get("info") or {}).get("name") or "Collection", "requests": out, "variables": variables}


# ------------------------------------------------------------------ Insomnia in

def _ins_vars(text):
    # {{ _.baseUrl }} -> {{baseUrl}}
    return re.sub(r"\{\{\s*_\.([\w.-]+)\s*\}\}", r"{{\1}}", text or "")


def _from_insomnia(data):
    res = [r for r in data.get("resources") or [] if isinstance(r, dict)]
    groups = {r["_id"]: r for r in res if r.get("_type") == "request_group"}

    def folder_of(parent):
        names = []
        while parent in groups:
            names.append(str(groups[parent].get("name") or "").strip())
            parent = groups[parent].get("parentId")
        return "/".join(n for n in reversed(names) if n)

    out, variables = [], []
    for r in res:
        t = r.get("_type")
        if t == "request":
            headers = [
                {"key": h.get("name", ""), "value": _ins_vars(str(h.get("value", ""))), "enabled": not h.get("disabled")}
                for h in r.get("headers") or []
            ]
            body = _ins_vars((r.get("body") or {}).get("text") or "")
            auth = r.get("authentication") or {}
            bearer = _ins_vars(auth.get("token") or "") if auth.get("type") == "bearer" and not auth.get("disabled") else ""
            out.append(_req(r.get("name"), r.get("method"), _ins_vars(r.get("url")), headers, body, bearer, folder_of(r.get("parentId"))))
        elif t == "environment" and isinstance(r.get("data"), dict):
            for k, v in r["data"].items():
                if isinstance(v, (str, int, float)):
                    variables.append({"key": k, "value": str(v), "enabled": True})
    ws = next((r for r in res if r.get("_type") == "workspace"), None)
    return {"name": (ws or {}).get("name") or "Collection Insomnia", "requests": out, "variables": variables}


# ------------------------------------------------------------------ dialogs

def import_collection():
    picked = webview.windows[0].create_file_dialog(
        webview.FileDialog.OPEN, file_types=("Collections JSON (*.json)", "Tous les fichiers (*.*)")
    )
    if not picked:
        return {"cancelled": True}
    src = picked[0] if isinstance(picked, (list, tuple)) else picked
    try:
        data = json.loads(Path(src).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        return {"error": f"Lecture du fichier : {e}"}
    if not isinstance(data, dict):
        return {"error": "Format non reconnu"}
    if "item" in data and isinstance(data.get("info"), dict):
        res = _from_postman(data)
    elif data.get("_type") == "export" or "resources" in data:
        res = _from_insomnia(data)
    else:
        return {"error": "Format non reconnu (collection Postman v2.1 ou export Insomnia v4 attendus)"}
    if not res["requests"]:
        return {"error": "La collection ne contient aucune requête"}
    res["file"] = Path(src).name
    return res


def _to_pm_item(r):
    url = r.get("url") or ""
    raw = "{{baseUrl}}" + url if url.startswith("/") else url
    item = {
        "name": r.get("name") or f"{r.get('method')} {url}",
        "request": {
            "method": r.get("method") or "GET",
            "header": [
                {"key": h.get("key"), "value": h.get("value", ""), **({"disabled": True} if h.get("enabled") is False else {})}
                for h in r.get("headers") or []
                if h.get("key")
            ],
            "url": {"raw": raw},
        },
    }
    if r.get("body") and (r.get("method") or "GET") != "GET":
        body = {"mode": "raw", "raw": r["body"]}
        if r["body"].lstrip()[:1] in ("{", "["):
            body["options"] = {"raw": {"language": "json"}}
        item["request"]["body"] = body
    if r.get("bearer"):
        item["request"]["auth"] = {"type": "bearer", "bearer": [{"key": "token", "value": r["bearer"], "type": "string"}]}
    return item


def export_collection(name, store):
    """Postman v2.1 file for the project's saved requests (folders kept)."""
    reqs = [r for r in store.get("requests") or [] if isinstance(r, dict)]
    if not reqs:
        return {"error": "Aucune requête à exporter"}
    root = {"name": name, "item": []}
    folders = {"": root}

    def get_folder(path):
        if path in folders:
            return folders[path]
        parent_path, _, leaf = path.rpartition("/")
        node = {"name": leaf, "item": []}
        get_folder(parent_path)["item"].append(node)
        folders[path] = node
        return node

    for r in reqs:
        get_folder((r.get("folder") or "").strip("/"))["item"].append(_to_pm_item(r))
    from .client import active_environment

    env = active_environment(store)
    variables = [{"key": "baseUrl", "value": env.get("baseUrl") or "", "type": "string"}]
    variables += [{"key": v["key"], "value": v.get("value", ""), "type": "string"} for v in env.get("variables") or [] if v.get("key")]
    doc = {"info": {"name": name, "schema": POSTMAN_SCHEMA}, "item": root["item"], "variable": variables}

    safe = re.sub(r"[^\w.-]+", "_", name) or "collection"
    dest = webview.windows[0].create_file_dialog(
        webview.FileDialog.SAVE, save_filename=f"{safe}.postman_collection.json", file_types=("Collection Postman (*.json)",)
    )
    if not dest:
        return {"cancelled": True}
    dest = dest[0] if isinstance(dest, (list, tuple)) else dest
    if not dest.lower().endswith(".json"):
        dest += ".json"
    try:
        Path(dest).write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError as e:
        return {"error": str(e)}
    return {"path": dest, "count": len(reqs)}

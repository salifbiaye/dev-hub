"""Mini HTTP client for the "Requêtes" tab: send a request, keep the project's saved
requests and variables, and fetch an OpenAPI description. Standard library only."""

import hashlib
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from app_config import APP_DATA_DIR

MAX_BODY = 2 * 1024 * 1024
STORE_DIR = APP_DATA_DIR / "http"
_VAR = re.compile(r"\{\{\s*([\w.-]+)\s*\}\}")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def _fill(text, variables):
    """{{name}} -> its value; unknown names are left as they are, visibly."""
    return _VAR.sub(lambda m: str(variables.get(m.group(1), m.group(0))), text or "")


def _decode(raw, content_type):
    charset = None
    m = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    if m:
        charset = m.group(1)
    for enc in (charset, "utf-8", "latin-1"):
        if not enc:
            continue
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="replace")


def send_request(request, variables=None):
    variables = variables or {}
    method = str(request.get("method") or "GET").upper()
    url = _fill(str(request.get("url") or "").strip(), variables)
    if not url:
        return {"error": "URL vide"}
    if not re.match(r"^https?://", url, re.I):
        url = "http://" + url
    headers = {}
    for h in request.get("headers") or []:
        if h.get("enabled", True) and str(h.get("key") or "").strip():
            headers[_fill(h["key"].strip(), variables)] = _fill(str(h.get("value") or ""), variables)
    params = [(p["key"], p.get("value", "")) for p in (request.get("params") or []) if p.get("enabled", True) and str(p.get("key") or "").strip()]
    if params:
        sep = "&" if "?" in url else "?"
        url += sep + urllib.parse.urlencode([(_fill(k, variables), _fill(str(v), variables)) for k, v in params])
    auth = request.get("bearer")
    if auth and "authorization" not in {k.lower() for k in headers}:
        headers["Authorization"] = "Bearer " + _fill(str(auth), variables)
    body = request.get("body")
    data = None
    if body not in (None, "") and method not in ("GET", "HEAD"):
        data = _fill(str(body), variables).encode("utf-8")
        if "content-type" not in {k.lower() for k in headers}:
            stripped = data.lstrip()[:1]
            headers["Content-Type"] = "application/json" if stripped in (b"{", b"[") else "text/plain; charset=utf-8"
    headers.setdefault("User-Agent", "DevHub")
    headers.setdefault("Accept", "*/*")

    ctx = None
    if request.get("insecure") and url.lower().startswith("https"):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    handlers = [urllib.request.HTTPSHandler(context=ctx)] if ctx else []
    if request.get("follow_redirects") is False:
        handlers.append(_NoRedirect())
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    timeout = max(1, min(int(request.get("timeout") or 30), 300))
    started = time.perf_counter()
    status = reason = None
    resp_headers = []
    raw = b""
    try:
        with opener.open(req, timeout=timeout) as resp:
            status, reason = resp.status, resp.reason
            resp_headers = list(resp.headers.items())
            raw = resp.read(MAX_BODY + 1)
    except urllib.error.HTTPError as e:  # 4xx / 5xx still carry a response worth reading
        status, reason = e.code, e.reason
        resp_headers = list(e.headers.items()) if e.headers else []
        try:
            raw = e.read(MAX_BODY + 1)
        except Exception:
            raw = b""
    except urllib.error.URLError as e:
        reason = e.reason
        msg = str(reason)
        if "refused" in msg.lower() or "10061" in msg:
            msg = "Connexion refusée : le serveur est-il lancé ?"
        elif "timed out" in msg.lower():
            msg = f"Délai dépassé ({timeout} s)"
        return {"error": msg, "url": url}
    except TimeoutError:
        return {"error": f"Délai dépassé ({timeout} s)", "url": url}
    except Exception as e:
        return {"error": str(e), "url": url}
    elapsed = round((time.perf_counter() - started) * 1000)
    truncated = len(raw) > MAX_BODY
    raw = raw[:MAX_BODY]
    ctype = next((v for k, v in resp_headers if k.lower() == "content-type"), "")
    text = _decode(raw, ctype)
    pretty = None
    if "json" in ctype.lower() or text.lstrip()[:1] in ("{", "["):
        try:
            pretty = json.dumps(json.loads(text), indent=2, ensure_ascii=False)
        except ValueError:
            pretty = None
    return {
        "status": status,
        "reason": str(reason or ""),
        "headers": [[k, v] for k, v in resp_headers],
        "body": text,
        "pretty": pretty,
        "content_type": ctype,
        "size": len(raw),
        "ms": elapsed,
        "truncated": truncated,
        "url": url,
    }


# ------------------------------------------------------------------ storage

def _store_path(repo_path):
    key = hashlib.sha1(str(Path(repo_path).resolve()).lower().encode("utf-8")).hexdigest()[:16]
    return STORE_DIR / f"{key}.json"


def _migrate(data):
    """Older files kept one flat variable list and one server URL: they become the
    first environment."""
    if not isinstance(data.get("environments"), list):
        data["environments"] = [
            {
                "id": "default",
                "name": "Local",
                "baseUrl": data.get("baseUrl") or "",
                "variables": [v for v in (data.get("variables") or []) if isinstance(v, dict)],
            }
        ]
        data["activeEnv"] = "default"
    data.setdefault("folders", [])
    data.setdefault("requests", [])
    return data


def load_store(repo_path):
    try:
        data = json.loads(_store_path(repo_path).read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return _migrate(data)
    except (OSError, ValueError):
        pass
    return _migrate({})


def active_environment(store):
    envs = store.get("environments") or []
    return next((e for e in envs if e.get("id") == store.get("activeEnv")), envs[0] if envs else {"name": "", "baseUrl": "", "variables": []})


def save_store(repo_path, data):
    if not isinstance(data, dict):
        return {"error": "Format invalide"}
    envs = []
    for e in (data.get("environments") or [])[:30]:
        if isinstance(e, dict) and e.get("id"):
            envs.append(
                {
                    "id": str(e["id"]),
                    "name": str(e.get("name") or "Sans nom")[:60],
                    "baseUrl": str(e.get("baseUrl") or "")[:300],
                    "variables": [v for v in (e.get("variables") or []) if isinstance(v, dict)][:200],
                }
            )
    clean = {
        "requests": [r for r in (data.get("requests") or []) if isinstance(r, dict)][:2000],
        "folders": [str(f)[:200] for f in (data.get("folders") or []) if f][:300],
        "environments": envs,
        "activeEnv": str(data.get("activeEnv") or (envs[0]["id"] if envs else "")),
    }
    try:
        STORE_DIR.mkdir(parents=True, exist_ok=True)
        _store_path(repo_path).write_text(json.dumps(clean, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError as e:
        return {"error": str(e)}
    return {"ok": True}


# ------------------------------------------------------------------ OpenAPI

def _sample(schema, spec, depth=0):
    """A small example value for a JSON schema (enough to start a request)."""
    if not isinstance(schema, dict) or depth > 4:
        return None
    if "$ref" in schema:
        node = spec
        for part in str(schema["$ref"]).lstrip("#/").split("/"):
            node = node.get(part, {}) if isinstance(node, dict) else {}
        return _sample(node, spec, depth + 1)
    if "example" in schema:
        return schema["example"]
    if "enum" in schema and schema["enum"]:
        return schema["enum"][0]
    t = schema.get("type")
    if t == "object" or "properties" in schema:
        return {k: _sample(v, spec, depth + 1) for k, v in (schema.get("properties") or {}).items()}
    if t == "array":
        item = _sample(schema.get("items"), spec, depth + 1)
        return [item] if item is not None else []
    return {"string": "string", "integer": 0, "number": 0, "boolean": False}.get(t, None if t else "string")


def fetch_openapi(url, insecure=False):
    res = send_request({"method": "GET", "url": url, "insecure": insecure, "timeout": 8})
    if res.get("error"):
        return {"error": res["error"]}
    if res.get("status") != 200:
        return {"error": f"HTTP {res.get('status')} sur {url}"}
    try:
        spec = json.loads(res["body"])
    except ValueError:
        return {"error": "Ce n'est pas un JSON OpenAPI"}
    if not isinstance(spec, dict) or not (spec.get("paths") or spec.get("openapi") or spec.get("swagger")):
        return {"error": "Ce n'est pas une description OpenAPI"}
    endpoints = []
    for path, item in (spec.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        for method in ("get", "post", "put", "patch", "delete"):
            op = item.get(method)
            if not isinstance(op, dict):
                continue
            body = None
            rb = ((op.get("requestBody") or {}).get("content") or {}).get("application/json") or {}
            if rb.get("schema"):
                sample = _sample(rb["schema"], spec)
                body = json.dumps(sample, indent=2, ensure_ascii=False) if sample is not None else None
            params = [
                {"key": p.get("name"), "in": p.get("in"), "required": bool(p.get("required"))}
                for p in (op.get("parameters") or [])
                if isinstance(p, dict) and p.get("name")
            ]
            endpoints.append(
                {
                    "method": method.upper(),
                    "path": path,
                    "summary": op.get("summary") or op.get("operationId") or "",
                    "tag": (op.get("tags") or ["API"])[0],
                    "body": body,
                    "params": params,
                }
            )
    return {"ok": True, "title": (spec.get("info") or {}).get("title"), "endpoints": endpoints}


# ------------------------------------------------------------------ base URL

OPENAPI_PATHS = ["/v3/api-docs", "/openapi.json", "/swagger.json", "/api-docs", "/docs-json", "/api/openapi.json"]


def guess_base(repo_path):
    """Where the project's server most likely listens (config first, then the framework default)."""
    base = Path(repo_path)
    port = None
    prefix = ""
    for rel in (
        "src/main/resources/application.properties",
        "src/main/resources/application.yml",
        "src/main/resources/application.yaml",
        "application.properties",
        ".env",
        ".env.local",
        "backend/.env",
    ):
        f = base / rel
        if not f.is_file():
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        m = re.search(r"^\s*(?:server\.port|PORT)\s*[=:]\s*[\"']?(?:\$\{\w+:)?(\d{2,5})", text, re.M)
        if not m and rel.endswith((".yml", ".yaml")):
            m = re.search(r"^server:[ \t]*\n(?:[ \t]+.*\n)*?[ \t]+port:[ \t]*(?:\$\{\w+:)?(\d{2,5})", text, re.M)
        if m:
            port = int(m.group(1))
        c = re.search(r"^\s*(?:server\.servlet\.)?context-path\s*[=:]\s*(\S+)", text, re.M)
        if c and not prefix:
            prefix = "/" + c.group(1).strip("/\"'")
        if m:
            break
    if port is None:
        if (base / "pom.xml").exists() or (base / "build.gradle").exists() or (base / "build.gradle.kts").exists():
            port = 8080
        elif (base / "manage.py").exists():
            port = 8000
        elif (base / "go.mod").exists():
            port = 8080
        elif (base / "package.json").exists():
            port = 3000
        else:
            port = 8000
    return {"baseUrl": f"http://localhost:{port}{prefix}", "context": prefix}


def discover_openapi(base_url, insecure=False):
    """Tries the usual OpenAPI locations on a running server."""
    base_url = (base_url or "").rstrip("/")
    last = "Aucune description OpenAPI trouvée"
    for p in OPENAPI_PATHS:
        res = fetch_openapi(base_url + p, insecure)
        if res.get("ok"):
            res["url"] = base_url + p
            return res
        if res.get("error", "").startswith("Connexion refusée"):
            return res  # nothing listens there: no point trying the others
        last = res.get("error") or last
    return {"error": last}


# ------------------------------------------------------------------ routes read from the code

_SKIP = {".git", "node_modules", "dist", "build", "target", ".venv", "venv", "__pycache__", ".next", ".gradle", ".idea", "out", "coverage", "test", "tests", "__tests__"}
_SPRING = {"Get": "GET", "Post": "POST", "Put": "PUT", "Patch": "PATCH", "Delete": "DELETE"}
_STR = r"\"([^\"]*)\""


def _join(*parts):
    path = "/".join(p.strip("/") for p in parts if p and p.strip("/"))
    return "/" + path


def _first_path(args):
    m = re.search(r"(?:value|path)?\s*=?\s*\{?\s*" + _STR, args or "")
    return m.group(1) if m else ""


def _scan_spring(text, name):
    if "@RestController" not in text and "@Controller" not in text:
        return []
    cls = re.search(r"\b(?:class|object)\s+(\w+)", text)
    tag = re.sub(r"Controller$", "", cls.group(1) if cls else name) or name
    base = ""
    header = text[: cls.start()] if cls else ""
    heads = re.findall(r"@RequestMapping\(([^)]*)\)", header, re.S)
    if heads:
        base = _first_path(heads[-1])
    out = []
    for m in re.finditer(r"@(Get|Post|Put|Patch|Delete)Mapping(?:\(([^)]*)\))?", text):
        out.append({"method": _SPRING[m.group(1)], "path": _join(base, _first_path(m.group(2))), "tag": tag})
    for m in re.finditer(r"@RequestMapping\(([^)]*RequestMethod\.(\w+)[^)]*)\)", text):
        out.append({"method": m.group(2).upper(), "path": _join(base, _first_path(m.group(1))), "tag": tag})
    return out


def _scan_js(text, name):
    out = []
    tag = name.rsplit(".", 1)[0]
    ctl = re.search(r"@Controller\(\s*['\"]([^'\"]*)['\"]", text)
    if ctl:  # NestJS
        base = ctl.group(1)
        for m in re.finditer(r"@(Get|Post|Put|Patch|Delete)\(\s*(?:['\"]([^'\"]*)['\"])?\s*\)", text):
            out.append({"method": m.group(1).upper(), "path": _join(base, (m.group(2) or "").replace(":", ":")), "tag": tag})
        return out
    for m in re.finditer(r"\b(?:app|router|server|api|fastify|route)\.(get|post|put|patch|delete)\(\s*['\"`]([^'\"`]+)['\"`]", text):
        path = re.sub(r":(\w+)", r"{\1}", m.group(2))
        out.append({"method": m.group(1).upper(), "path": _join(path), "tag": tag})
    return out


def _scan_py(text, name):
    out = []
    tag = name.rsplit(".", 1)[0]
    for m in re.finditer(r"@\w+\.(get|post|put|patch|delete)\(\s*['\"]([^'\"]*)['\"]", text):
        out.append({"method": m.group(1).upper(), "path": _join(m.group(2)), "tag": tag})
    for m in re.finditer(r"@\w+\.route\(\s*['\"]([^'\"]*)['\"]([^)]*)\)", text):
        methods = re.findall(r"['\"](GET|POST|PUT|PATCH|DELETE)['\"]", m.group(2), re.I) or ["GET"]
        for meth in methods:
            out.append({"method": meth.upper(), "path": _join(re.sub(r"<(?:\w+:)?(\w+)>", r"{\1}", m.group(1))), "tag": tag})
    return out


def _scan_go(text, name):
    out = []
    tag = name.rsplit(".", 1)[0]
    for m in re.finditer(r"\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*\"(/[^\"]*)\"", text):
        out.append({"method": m.group(1).upper(), "path": _join(re.sub(r":(\w+)", r"{\1}", m.group(2))), "tag": tag})
    return out


def _scan_php(text, name):
    out = []
    tag = name.rsplit(".", 1)[0]
    for m in re.finditer(r"Route::(get|post|put|patch|delete)\(\s*['\"]([^'\"]*)['\"]", text):
        out.append({"method": m.group(1).upper(), "path": _join(m.group(2)), "tag": tag})
    return out


def _scan_cs(text, name):
    if "[ApiController]" not in text and "ControllerBase" not in text:
        return []
    cls = re.search(r"\bclass\s+(\w+)", text)
    cname = re.sub(r"Controller$", "", cls.group(1)) if cls else name
    header = text[: cls.start()] if cls else ""
    route = re.findall(r"\[Route\(\"([^\"]*)\"\)\]", header)
    base = (route[-1] if route else "").replace("[controller]", cname.lower())
    out = []
    for m in re.finditer(r"\[Http(Get|Post|Put|Patch|Delete)(?:\(\"([^\"]*)\"\))?\]", text):
        out.append({"method": m.group(1).upper(), "path": _join(base, m.group(2) or ""), "tag": cname})
    return out


def _scan_django(text, name):
    if name != "urls.py":
        return []
    out = []
    for m in re.finditer(r"\bpath\(\s*['\"]([^'\"]*)['\"]", text):
        out.append({"method": "GET", "path": _join(re.sub(r"<(?:\w+:)?(\w+)>", r"{\1}", m.group(1))), "tag": "django"})
    return out


# extension -> [(framework label, scanner)]
_SCANNERS = {
    ".java": [("Spring", _scan_spring)],
    ".kt": [("Spring / Ktor", _scan_spring)],
    ".js": [("Express / Nest", _scan_js)],
    ".ts": [("Express / Nest", _scan_js)],
    ".mjs": [("Express / Nest", _scan_js)],
    ".cjs": [("Express / Nest", _scan_js)],
    ".py": [("FastAPI / Flask", _scan_py), ("Django", _scan_django)],
    ".go": [("Go", _scan_go)],
    ".php": [("Laravel", _scan_php)],
    ".cs": [("ASP.NET", _scan_cs)],
}


def _regroup(found):
    """Folders by URL (/admin, /auth, /admin/immo…) rather than by controller class: the
    same prefix is what a person looks for. A prefix with many routes is split in two."""

    def segs(path):
        return [x for x in path.strip("/").split("/") if x and not x.startswith("{")]

    counts = {}
    for r in found:
        first = (segs(r["path"]) or [""])[0]
        counts[first] = counts.get(first, 0) + 1
    for r in found:
        parts = segs(r["path"])
        first = parts[0] if parts else ""
        if not first:
            r["tag"] = "(racine)"
        elif counts[first] > 25 and len(parts) > 1:
            r["tag"] = f"{first} / {parts[1]}"
        else:
            r["tag"] = first


def scan_routes(repo_path):
    """Routes written in the code (Spring, NestJS, Express / Fastify, FastAPI, Flask, Django,
    Go, Laravel, ASP.NET), for when the server isn't running and there is no OpenAPI to read."""
    base = Path(repo_path)
    if not base.is_dir():
        return {"error": "Dossier introuvable"}
    found, seen, frameworks = [], set(), {}
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in _SKIP]
        for f in files:
            scanners = _SCANNERS.get(Path(f).suffix.lower())
            if not scanners:
                continue
            p = Path(root) / f
            try:
                if p.stat().st_size > 400_000:
                    continue
                text = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for label, scan in scanners:
                for r in scan(text, f):
                    key = (r["method"], r["path"])
                    if key in seen:
                        continue
                    seen.add(key)
                    frameworks[label] = frameworks.get(label, 0) + 1
                    found.append({**r, "summary": "", "body": None, "params": []})
            if len(found) > 3000:
                break
    if not found:
        return {"error": "Aucune route trouvée dans le code (frameworks lus : Spring, Nest, Express, FastAPI, Flask, Django, Go, Laravel, ASP.NET)"}
    _regroup(found)
    found.sort(key=lambda e: (e["tag"].lower(), e["path"], e["method"]))
    names = ", ".join(sorted(frameworks, key=frameworks.get, reverse=True))
    return {"ok": True, "title": "Routes du code", "endpoints": found, "source": "code", "frameworks": names}


def import_routes(repo_path, base_url, insecure=False):
    """OpenAPI of the running server when there is one, else the routes found in the code."""
    live = discover_openapi(base_url, insecure)
    if live.get("ok"):
        live["source"] = "serveur"
        return live
    code = scan_routes(repo_path)
    if code.get("ok"):
        code["note"] = f"Serveur éteint : routes lues dans le code ({code.get('frameworks')}), sans corps d'exemple."
        return code
    return {"error": live.get("error") or code.get("error")}

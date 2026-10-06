import fnmatch
import os
import re
import sqlite3
from pathlib import Path

import psycopg2
import pymongo
import pymysql

from app_config import load_config, save_config

_PG_URI_RE = re.compile(r'postgres(?:ql)?://(?:([^:@/]+)(?::([^@/]*))?@)?([^:/\s\'"]+)(?::(\d+))?/([^?\s\'"]+)')
_JDBC_PG_RE = re.compile(r'jdbc:postgresql://([^:/\s\'"]+)(?::(\d+))?/([^?\s\'"]+)')
_MYSQL_URI_RE = re.compile(r'(mysql|mariadb)://(?:([^:@/]+)(?::([^@/]*))?@)?([^:/\s\'"]+)(?::(\d+))?/([^?\s\'"]+)')
_JDBC_MYSQL_RE = re.compile(r'jdbc:(mysql|mariadb)://([^:/\s\'"]+)(?::(\d+))?/([^?\s\'"]+)')
_MONGO_URI_RE = re.compile(r'mongodb(?:\+srv)?://[^\s\'"]+')
_SQLITE_URI_RE = re.compile(r'(?:sqlite:/{2,3}|jdbc:sqlite:|file:)([^\s\'"?]+\.(?:db|sqlite|sqlite3))')
_DB_USER_KEYS = ("DB_USER", "DB_USERNAME", "POSTGRES_USER", "PGUSER", "DATABASE_USER", "MYSQL_USER")
_DB_PASSWORD_KEYS = (
    "DB_PASSWORD",
    "DB_PASS",
    "POSTGRES_PASSWORD",
    "PGPASSWORD",
    "DATABASE_PASSWORD",
    "MYSQL_PASSWORD",
)
_MONGO_HOST_RE = re.compile(r'mongodb(?:\+srv)?://(?:[^@/]+@)?([^/?\s\'"]+)')
_MONGO_DB_RE = re.compile(r'mongodb(?:\+srv)?://[^/\s\'"]+/([^?\s\'"]+)')
_DB_LABELS = {"postgres": "PostgreSQL", "mysql": "MySQL", "sqlite": "SQLite", "mongo": "MongoDB"}
_db_connections = {}


def mongo_db_name(uri):
    m = _MONGO_DB_RE.search(uri or "")
    return m.group(1) if m else None


def _read_env_kv(env_path):
    kv = {}
    try:
        text = env_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return kv
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        kv[key.strip()] = value.strip().strip("\"'")
    return kv


def _fill_credentials(parsed, kv, base):
    """SQL engines often split credentials out of the URL (Spring style) — pull
    them from sibling env keys, and resolve a relative sqlite path."""
    if parsed["engine"] in ("postgres", "mysql"):
        if not parsed.get("user"):
            parsed["user"] = next((kv[k] for k in _DB_USER_KEYS if k in kv), None)
        if not parsed.get("password"):
            parsed["password"] = next((kv[k] for k in _DB_PASSWORD_KEYS if k in kv), None)
        parsed["user"] = parsed.get("user") or ("postgres" if parsed["engine"] == "postgres" else "root")
        parsed["password"] = parsed.get("password") or ""
    elif parsed["engine"] == "sqlite":
        file_path = Path(parsed["file"])
        if not file_path.is_absolute():
            file_path = base / parsed["file"].lstrip("./")
        parsed["file"] = str(file_path)
    return parsed


def _parse_db_from_value(value):
    m = _PG_URI_RE.search(value)
    if m:
        user, password, host, port, db = m.groups()
        return {
            "engine": "postgres",
            "host": host,
            "port": int(port or 5432),
            "database": db,
            "user": user,
            "password": password or "",
        }
    m = _JDBC_PG_RE.search(value)
    if m:
        host, port, db = m.groups()
        return {"engine": "postgres", "host": host, "port": int(port or 5432), "database": db}

    m = _MYSQL_URI_RE.search(value)
    if m:
        flavor, user, password, host, port, db = m.groups()
        return {
            "engine": "mysql",
            "flavor": flavor,
            "host": host,
            "port": int(port or 3306),
            "database": db,
            "user": user,
            "password": password or "",
        }
    m = _JDBC_MYSQL_RE.search(value)
    if m:
        flavor, host, port, db = m.groups()
        return {"engine": "mysql", "flavor": flavor, "host": host, "port": int(port or 3306), "database": db}

    m = _MONGO_URI_RE.search(value)
    if m:
        return {"engine": "mongo", "uri": m.group(0)}

    m = _SQLITE_URI_RE.search(value)
    if m:
        return {"engine": "sqlite", "file": m.group(1)}

    return None


def _saved_db_config(path):
    """A manual config saved by the user always wins over auto-detection."""
    config = load_config()
    repo = next((r for r in config["repos"] if r["path"] == path), None)
    db = (repo or {}).get("db")
    if not db or not db.get("engine"):
        return None
    parsed = dict(db)
    parsed["manual"] = True
    return parsed


_SCAN_SKIP_DIRS = {
    "node_modules", "target", "build", "dist", ".git", ".gradle", ".idea",
    "venv", ".venv", "__pycache__", ".next", ".expo", "vendor", "Pods",
    "out", "coverage", ".cache", "android/build", "ios/build",
}
_SCAN_MAX_DEPTH = 4


def _walk_config_files(base, pattern):
    """Find config files without descending into dependency trees.

    Path.rglob() walks everything — on a React Native project that meant
    ~19s spent inside node_modules before concluding there was no database.
    Pruning as we go keeps it in the millisecond range.
    """
    base = Path(base)
    for root, dirs, files in os.walk(base):
        depth = len(Path(root).relative_to(base).parts)
        if depth >= _SCAN_MAX_DEPTH:
            dirs[:] = []
        else:
            dirs[:] = [d for d in dirs if d not in _SCAN_SKIP_DIRS and not d.startswith(".")]
        for name in fnmatch.filter(files, pattern):
            yield Path(root) / name


def detect_database(path):
    saved = _saved_db_config(path)
    if saved:
        return saved

    base = Path(path)

    for env_path in sorted(base.glob(".env*")):
        if not env_path.is_file():
            continue
        kv = _read_env_kv(env_path)
        for value in kv.values():
            parsed = _parse_db_from_value(value)
            if parsed:
                return _fill_credentials(parsed, kv, base)

    # Fallback: a literal (non-placeholder) URL hardcoded directly in a config
    # file, for projects that don't route it through .env.
    patterns = (
        "application*.yml",
        "application*.yaml",
        "application*.properties",
        "schema.prisma",
        "docker-compose*.yml",
    )
    for pattern in patterns:
        for cfg_path in _walk_config_files(base, pattern):
            try:
                text = cfg_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            parsed = _parse_db_from_value(text)
            if not parsed:
                continue
            user_m = re.search(r"username\s*[:=]\s*([^\s'\"$]+)", text)
            pass_m = re.search(r"password\s*[:=]\s*([^\s'\"$]+)", text)
            if parsed["engine"] in ("postgres", "mysql"):
                if user_m and not parsed.get("user"):
                    parsed["user"] = user_m.group(1)
                if pass_m and not parsed.get("password"):
                    parsed["password"] = pass_m.group(1)
            return _fill_credentials(parsed, {}, base)

    # Last resort: a bare sqlite file sitting in the repo.
    for pattern in ("*.db", "*.sqlite", "*.sqlite3", "prisma/*.db"):
        for db_file in base.glob(pattern):
            if db_file.is_file():
                return {"engine": "sqlite", "file": str(db_file)}

    return None


class DatabaseConnectMixin:
    def detect_database(self, path):
        parsed = detect_database(path)
        if not parsed:
            _db_connections.pop(path, None)
            return {"found": False}
        _db_connections[path] = parsed
        engine = parsed["engine"]
        info = {
            "found": True,
            "engine": engine,
            "label": _DB_LABELS.get(engine, engine),
            "manual": bool(parsed.get("manual")),
            "has_password": bool(parsed.get("password")),
        }
        if engine == "sqlite":
            info["file"] = parsed["file"]
            info["database"] = Path(parsed["file"]).name
        elif engine == "mongo":
            # Never surface the raw URI — it carries the password.
            info["database"] = mongo_db_name(parsed["uri"]) or "(défaut)"
            info["host"] = _MONGO_HOST_RE.search(parsed["uri"]).group(1) if _MONGO_HOST_RE.search(parsed["uri"]) else ""
        else:
            if parsed.get("flavor") == "mariadb":
                info["label"] = "MariaDB"
            info.update(
                {
                    "host": parsed["host"],
                    "port": parsed["port"],
                    "database": parsed["database"],
                    "user": parsed.get("user"),
                }
            )
        return info

    def save_db_config(self, path, cfg):
        engine = (cfg or {}).get("engine")
        if engine not in _DB_LABELS:
            return {"error": "Moteur invalide"}
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        if not repo:
            return {"error": "Projet introuvable"}

        entry = {"engine": engine}
        if engine == "sqlite":
            if not cfg.get("file"):
                return {"error": "Chemin du fichier SQLite requis"}
            entry["file"] = cfg["file"].strip()
        elif engine == "mongo":
            # Empty means "keep the saved URI" — it carries the password, so
            # it is never sent to the frontend to be re-submitted.
            uri = (cfg.get("uri") or "").strip() or (repo.get("db") or {}).get("uri", "")
            if not uri:
                return {"error": "URI Mongo requise"}
            entry["uri"] = uri
        else:
            if not cfg.get("host") or not cfg.get("database"):
                return {"error": "Hôte et base requis"}
            entry["host"] = cfg["host"].strip()
            entry["port"] = int(cfg.get("port") or (5432 if engine == "postgres" else 3306))
            entry["database"] = cfg["database"].strip()
            entry["user"] = (cfg.get("user") or "").strip()
            # An empty password field means "keep the one already saved".
            password = cfg.get("password")
            entry["password"] = password if password else (repo.get("db") or {}).get("password", "")

        repo["db"] = entry
        save_config(config)
        _db_connections.pop(path, None)
        return {"ok": True}

    def clear_db_config(self, path):
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        if repo:
            repo.pop("db", None)
            save_config(config)
        _db_connections.pop(path, None)
        return {"ok": True}

    def _open_db_connection(self, conn_info):
        engine = conn_info["engine"]
        try:
            if engine == "postgres":
                return (
                    psycopg2.connect(
                        host=conn_info["host"],
                        port=conn_info["port"],
                        dbname=conn_info["database"],
                        user=conn_info.get("user") or "postgres",
                        password=conn_info.get("password") or "",
                        connect_timeout=5,
                    ),
                    engine,
                    None,
                )
            if engine == "mysql":
                return (
                    pymysql.connect(
                        host=conn_info["host"],
                        port=conn_info["port"],
                        database=conn_info["database"],
                        user=conn_info.get("user") or "root",
                        password=conn_info.get("password") or "",
                        connect_timeout=5,
                    ),
                    engine,
                    None,
                )
            if engine == "sqlite":
                if not Path(conn_info["file"]).exists():
                    return None, None, f"Fichier SQLite introuvable : {conn_info['file']}"
                return sqlite3.connect(conn_info["file"]), engine, None
            if engine == "mongo":
                client = pymongo.MongoClient(conn_info["uri"], serverSelectionTimeoutMS=5000)
                client.admin.command("ping")
                return client, engine, None
            return None, None, f"Moteur non supporté : {engine}"
        except Exception as e:
            return None, None, str(e)

    def _db_connect(self, path):
        conn_info = _db_connections.get(path) or detect_database(path)
        if not conn_info:
            return None, None, "Aucune base de données détectée pour ce projet."
        _db_connections[path] = conn_info
        return self._open_db_connection(conn_info)

    def test_db_config(self, path, cfg):
        # Lets the manual-config form validate credentials in ~1s before
        # saving, instead of saving blind and only finding out something's
        # wrong the next time a table is opened.
        engine = (cfg or {}).get("engine")
        if engine not in _DB_LABELS:
            return {"ok": False, "error": "Moteur invalide"}

        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        saved = (repo.get("db") if repo else None) or {}

        conn_info = {"engine": engine}
        if engine == "sqlite":
            conn_info["file"] = (cfg.get("file") or "").strip()
            if not conn_info["file"]:
                return {"ok": False, "error": "Chemin du fichier SQLite requis"}
        elif engine == "mongo":
            uri = (cfg.get("uri") or "").strip() or saved.get("uri", "")
            if not uri:
                return {"ok": False, "error": "URI Mongo requise"}
            conn_info["uri"] = uri
        else:
            if not cfg.get("host") or not cfg.get("database"):
                return {"ok": False, "error": "Hôte et base requis"}
            conn_info["host"] = cfg["host"].strip()
            conn_info["port"] = int(cfg.get("port") or (5432 if engine == "postgres" else 3306))
            conn_info["database"] = cfg["database"].strip()
            conn_info["user"] = (cfg.get("user") or "").strip()
            # Empty password in the form means "keep the saved one", same
            # convention as save_db_config.
            conn_info["password"] = cfg.get("password") or saved.get("password", "")

        conn, _, error = self._open_db_connection(conn_info)
        if error:
            return {"ok": False, "error": error}
        try:
            conn.close()
        except Exception:
            pass
        return {"ok": True}

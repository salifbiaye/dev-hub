import ctypes
import ctypes.wintypes as wintypes
import fnmatch
import json
import os
import re
import shlex
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import webview
import winpty
import psutil
import psycopg2
import pymongo
import pymysql
import win32clipboard
import win32con
import win32gui
import win32process

APP_DATA_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "DevHub"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = APP_DATA_DIR / "config.json"

APP_VERSION = "0.2.0"
GITHUB_REPO = "salifbiaye/dev-hub"

KNOWN_IDES = ["webstorm", "idea1", "pycharm", "code", "rider", "goland", "clion", "phpstorm"]

# Mirrors --color-accent for every theme in frontend/src/index.css, so the
# taskbar icon can be recolored to match instead of staying a fixed purple
# regardless of which theme is actually active.
THEME_ACCENTS = {
    "dark": "#6e56cf",
    "light": "#6e56cf",
    "tokyo-night": "#7aa2f7",
    "monokai": "#66d9ef",
    "catppuccin-mocha": "#cba6f7",
    "dracula": "#bd93f9",
    "nord": "#88c0d0",
    "gruvbox-dark": "#fe8019",
    "tokyo-day": "#2e7de9",
    "catppuccin-latte": "#8839ef",
    "atom-one-dark": "#61afef",
    "atom-one-light": "#4078f2",
    "halloween": "#ff7518",
    "diwali": "#f2b705",
    "movember": "#c17d3a",
    "dia-de-muertos": "#ff5f9e",
    "winter-day": "#3a7bd5",
    "solarized-dark": "#268bd2",
    "rose-pine": "#c4a7e7",
    "ayu-dark": "#ffb454",
    "synthwave": "#ff2e97",
    "night-owl": "#7fdbca",
    "palenight": "#f78c6c",
    "horizon": "#e95678",
    "everforest": "#a7c080",
    "indigo-black": "#6366f1",
    "crimson-black": "#ff3355",
    "emerald-black": "#10b981",
    "amber-black": "#f5a623",
}

# JetBrains Toolbox keeps a stale "idea" script pointing at an uninstalled version on this
# machine; "idea1" is the one that actually launches the current IntelliJ IDEA Ultimate.
STALE_IDE_ALIASES = {"idea": "idea1"}

# Plain "claude -p" boots a full interactive-grade session in the repo's
# cwd — loading CLAUDE.md/AGENTS.md, project settings, MCP servers, and
# tool scaffolding neither commit-message generation nor the "test
# connection" ping needs — which is what made both take 30s+ instead of a
# couple seconds. These flags skip all of that while still using the
# user's existing OAuth/subscription login (unlike --bare, which requires
# an API key and never reads OAuth or the keychain).
FASTER_CLAUDE_CLI = 'claude -p --setting-sources user --strict-mcp-config --tools "" --no-session-persistence'

COMMIT_LANGUAGE_NAMES = {
    "fr": "French",
    "en": "English",
    "es": "Spanish",
    "de": "German",
    "pt": "Portuguese",
}

IDE_LAUNCH_COOLDOWN_SECONDS = 5
_last_launch_at = {}

IDE_PROCESS_NAMES = {
    "webstorm": "webstorm64.exe",
    "idea1": "idea64.exe",
    "idea": "idea64.exe",
    "pycharm": "pycharm64.exe",
    "rider": "rider64.exe",
    "goland": "goland64.exe",
    "clion": "clion64.exe",
    "phpstorm": "phpstorm64.exe",
    "code": "Code.exe",
}


def _is_process_running(exe_name):
    try:
        result = subprocess.run(
            ["tasklist", "/NH", "/FI", f"IMAGENAME eq {exe_name}"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return exe_name.lower() in result.stdout.lower()
    except Exception:
        return False


def _get_pids_for_exe(exe_name):
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {exe_name}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        pids = []
        for line in result.stdout.strip().splitlines():
            parts = [p.strip('"') for p in line.split('","')]
            if len(parts) >= 2:
                try:
                    pids.append(int(parts[1]))
                except ValueError:
                    pass
        return pids
    except Exception:
        return []


# JetBrains keeps a per-IDE system directory holding the lock files it uses to
# hand a project off to an already-running instance.
IDE_SYSTEM_DIR_PREFIXES = {
    "webstorm": "WebStorm",
    "idea1": "IntelliJIdea",
    "idea": "IntelliJIdea",
    "pycharm": "PyCharm",
    "rider": "Rider",
    "goland": "GoLand",
    "clion": "CLion",
    "phpstorm": "PhpStorm",
}


def _ide_ipc_is_broken(launcher):
    """True when the IDE is running but never created its .port socket.

    In that state its single-instance channel doesn't exist, so asking it to
    open another project can't work — JetBrains answers with
    DirectoryLock$CannotActivateException instead, which looks like a crash.
    """
    prefix = IDE_SYSTEM_DIR_PREFIXES.get(launcher)
    exe_name = IDE_PROCESS_NAMES.get(launcher)
    # A stale .pid is left behind by past sessions, so this only means
    # anything while the IDE is actually up.
    if not prefix or not exe_name or not _is_process_running(exe_name):
        return False
    root = Path(os.environ.get("LOCALAPPDATA", "")) / "JetBrains"
    if not root.is_dir():
        return False
    candidates = sorted(
        (d for d in root.iterdir() if d.is_dir() and d.name.startswith(prefix)),
        key=lambda d: d.stat().st_mtime,
        reverse=True,
    )
    for d in candidates:
        # Only the instance that's actually running matters, and that's the
        # one holding a .pid file.
        if (d / ".pid").exists():
            return not (d / ".port").exists()
    return False


def _is_hung_window(hwnd):
    # pywin32's win32gui doesn't wrap IsHungAppWindow despite it being a
    # plain user32 export — go straight through ctypes instead. This used
    # to raise AttributeError on every "open a 2nd project in the same
    # running IDE" click, which pywebview's bridge didn't always turn into
    # a clean promise rejection, leaving the "Ouvrir" button spinning
    # forever with no error shown.
    return bool(ctypes.windll.user32.IsHungAppWindow(hwnd))


def _find_any_window(exe_name):
    pids = set(_get_pids_for_exe(exe_name))
    if not pids:
        return None
    target = None

    def callback(hwnd, _):
        nonlocal target
        if not win32gui.IsWindowVisible(hwnd) or not win32gui.GetWindowText(hwnd):
            return True
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        if pid in pids:
            target = hwnd
            return False
        return True

    try:
        win32gui.EnumWindows(callback, None)
    except Exception:
        pass
    return target


def _bring_to_front(exe_name, title_hint=None, require_title_match=False):
    # OpenProcess-based name lookup can silently fail to access JetBrains IDE
    # processes; tasklist already reliably finds them (used by
    # _is_process_running), so reuse it for the PIDs and just match windows
    # by owning PID — GetWindowThreadProcessId needs no special access.
    pids = set(_get_pids_for_exe(exe_name))
    if not pids:
        return False

    target_hwnd = None
    fallback_hwnd = None
    hint = (title_hint or "").lower()

    def callback(hwnd, _):
        nonlocal target_hwnd, fallback_hwnd
        if not win32gui.IsWindowVisible(hwnd) or not win32gui.GetWindowText(hwnd):
            return True
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        if pid in pids:
            title = win32gui.GetWindowText(hwnd)
            if hint and hint in title.lower():
                target_hwnd = hwnd
                return False
            if fallback_hwnd is None:
                fallback_hwnd = hwnd
        return True

    try:
        win32gui.EnumWindows(callback, None)
    except Exception:
        pass

    if not target_hwnd and require_title_match:
        return False
    target_hwnd = target_hwnd or fallback_hwnd
    if not target_hwnd:
        return False

    try:
        if win32gui.IsIconic(target_hwnd):
            win32gui.ShowWindow(target_hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(target_hwnd)
        return True
    except Exception:
        pass

    # Windows blocks SetForegroundWindow from background processes unless the
    # caller's thread is attached to the target's input queue — this trick
    # bypasses that restriction.
    try:
        fg_hwnd = win32gui.GetForegroundWindow()
        fg_thread = win32process.GetWindowThreadProcessId(fg_hwnd)[0]
        target_thread = win32process.GetWindowThreadProcessId(target_hwnd)[0]
        win32process.AttachThreadInput(fg_thread, target_thread, True)
        try:
            win32gui.SetForegroundWindow(target_hwnd)
        finally:
            win32process.AttachThreadInput(fg_thread, target_thread, False)
        return True
    except Exception:
        return False

_running = {}
# pywebview's Window has no "am I maximized" getter, so the frameless custom
# title bar's maximize/restore toggle has to track this itself.
_window_maximized = False
_terminals = {}
_terminal_buffers = {}
_TERMINAL_BUFFER_CAP = 200_000

# psutil.Process.cpu_percent(None) reports the delta since that *same
# object's* last call — a fresh Process() every poll would always read as
# 0%, so live instances are kept around across polls just for this.
_psutil_procs = {}
_CPU_COUNT = psutil.cpu_count() or 1

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


def _mongo_db_name(uri):
    m = _MONGO_DB_RE.search(uri or "")
    return m.group(1) if m else None


_INT_TYPES = {"integer", "int", "int2", "int4", "int8", "bigint", "smallint", "tinyint", "mediumint", "serial", "bigserial"}
_FLOAT_TYPES = {"numeric", "decimal", "real", "double precision", "double", "float", "money"}
_BOOL_TYPES = {"boolean", "bool"}
_JSON_TYPES = {"json", "jsonb"}
_DATE_TYPES = {"date"}
_DATETIME_TYPES = {"timestamp", "timestamp without time zone", "timestamp with time zone", "datetime"}
_TIME_TYPES = {"time"}


def _type_family(sql_type):
    t = (sql_type or "").lower().split("(")[0].strip()
    if t == "tinyint(1)" or t in _BOOL_TYPES:
        return "bool"
    if t in _INT_TYPES:
        return "int"
    if t in _FLOAT_TYPES:
        return "float"
    if t in _JSON_TYPES:
        return "json"
    if t in _DATETIME_TYPES:
        return "datetime"
    if t in _DATE_TYPES:
        return "date"
    if t in _TIME_TYPES:
        return "time"
    if "uuid" in t:
        return "uuid"
    return "text"


def _fetch_schema(conn, engine, table):
    """Column list (name/type/family/nullable/has_default/is_pk/fk) + the
    single-column primary key name, or None if there isn't exactly one."""
    cur = conn.cursor()
    columns = []
    pk_cols = set()
    fk_map = {}

    if engine == "sqlite":
        cur.execute(f'PRAGMA table_info("{table}")')
        for _cid, name, coltype, notnull, dflt, pk in cur.fetchall():
            columns.append({"name": name, "type": coltype or "", "nullable": not notnull, "has_default": dflt is not None})
            if pk:
                pk_cols.add(name)
        cur.execute(f'PRAGMA foreign_key_list("{table}")')
        for row in cur.fetchall():
            fk_map[row[3]] = {"table": row[2], "column": row[4]}

    elif engine == "postgres":
        cur.execute(
            "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position",
            (table,),
        )
        for name, coltype, nullable, default in cur.fetchall():
            columns.append({"name": name, "type": coltype, "nullable": nullable == "YES", "has_default": default is not None})
        cur.execute(
            "SELECT kcu.column_name FROM information_schema.table_constraints tc "
            "JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name "
            "AND tc.table_schema = kcu.table_schema "
            "WHERE tc.table_schema = 'public' AND tc.table_name = %s AND tc.constraint_type = 'PRIMARY KEY'",
            (table,),
        )
        pk_cols = {r[0] for r in cur.fetchall()}
        cur.execute(
            "SELECT kcu.column_name, ccu.table_name, ccu.column_name "
            "FROM information_schema.table_constraints tc "
            "JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name "
            "AND tc.table_schema = kcu.table_schema "
            "JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name "
            "AND tc.table_schema = ccu.table_schema "
            "WHERE tc.table_schema = 'public' AND tc.table_name = %s AND tc.constraint_type = 'FOREIGN KEY'",
            (table,),
        )
        for col, ref_table, ref_col in cur.fetchall():
            fk_map[col] = {"table": ref_table, "column": ref_col}

    elif engine == "mysql":
        cur.execute(
            "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = %s ORDER BY ordinal_position",
            (table,),
        )
        for name, coltype, nullable, default in cur.fetchall():
            columns.append({"name": name, "type": coltype, "nullable": nullable == "YES", "has_default": default is not None})
        cur.execute(
            "SELECT column_name FROM information_schema.key_column_usage "
            "WHERE table_schema = DATABASE() AND table_name = %s AND constraint_name = 'PRIMARY'",
            (table,),
        )
        pk_cols = {r[0] for r in cur.fetchall()}
        cur.execute(
            "SELECT column_name, referenced_table_name, referenced_column_name "
            "FROM information_schema.key_column_usage "
            "WHERE table_schema = DATABASE() AND table_name = %s AND referenced_table_name IS NOT NULL",
            (table,),
        )
        for col, ref_table, ref_col in cur.fetchall():
            fk_map[col] = {"table": ref_table, "column": ref_col}

    cur.close()
    for c in columns:
        c["family"] = _type_family(c["type"])
        c["is_pk"] = c["name"] in pk_cols
        c["fk"] = fk_map.get(c["name"])
    pk_column = next(iter(pk_cols)) if len(pk_cols) == 1 else None
    return columns, pk_column


_SKIP = object()


def _coerce_value(raw, family, nullable, has_default):
    if raw is None or raw == "":
        if has_default:
            return _SKIP, None
        if nullable:
            return None, None
        return None, "champ requis"
    if family == "int":
        try:
            return int(raw), None
        except (TypeError, ValueError):
            return None, "nombre entier attendu"
    if family == "float":
        try:
            return float(raw), None
        except (TypeError, ValueError):
            return None, "nombre attendu"
    if family == "bool":
        if isinstance(raw, bool):
            return raw, None
        s = str(raw).strip().lower()
        if s in ("true", "1", "yes", "on"):
            return True, None
        if s in ("false", "0", "no", "off"):
            return False, None
        return None, "booléen attendu (true/false)"
    if family == "json":
        try:
            json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            return None, "JSON invalide"
        return raw, None
    return raw, None


_FILTER_OPS = {"=": "=", "!=": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<=", "like": "LIKE"}
_MONGO_FILTER_OPS = {"=": "$eq", "!=": "$ne", ">": "$gt", "<": "$lt", ">=": "$gte", "<=": "$lte"}


def _build_where(engine, valid_columns, filters, placeholder):
    clauses, params = [], []
    quote = "`" if engine == "mysql" else '"'
    for f in filters or []:
        col = f.get("column")
        op = f.get("op")
        if col not in valid_columns:
            continue
        qcol = f"{quote}{col}{quote}"
        if op == "is null":
            clauses.append(f"{qcol} IS NULL")
        elif op == "is not null":
            clauses.append(f"{qcol} IS NOT NULL")
        elif op == "like" and op in _FILTER_OPS:
            clauses.append(f"{qcol} LIKE {placeholder}")
            params.append(f"%{f.get('value', '')}%")
        elif op in _FILTER_OPS:
            clauses.append(f"{qcol} {_FILTER_OPS[op]} {placeholder}")
            params.append(f.get("value", ""))
    if not clauses:
        return "", params
    return " WHERE " + " AND ".join(clauses), params


def _build_mongo_filter(filters):
    result = {}
    for f in filters or []:
        col = f.get("column")
        op = f.get("op")
        if not col:
            continue
        if op == "is null":
            result[col] = None
        elif op == "is not null":
            result[col] = {"$ne": None}
        elif op == "like":
            result[col] = {"$regex": re.escape(f.get("value", "")), "$options": "i"}
        elif op in _MONGO_FILTER_OPS:
            result[col] = {_MONGO_FILTER_OPS[op]: f.get("value", "")}
    return result


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


def _detect_database(path):
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


def _append_buffer(terminal_id, data):
    buf = _terminal_buffers.get(terminal_id, "") + data
    if len(buf) > _TERMINAL_BUFFER_CAP:
        buf = buf[-_TERMINAL_BUFFER_CAP:]
    _terminal_buffers[terminal_id] = buf


def _stream_terminal(terminal_id, proc):
    window = webview.windows[0]
    try:
        while proc.isalive():
            try:
                data = proc.read(4096)
            except EOFError:
                break
            if data:
                _append_buffer(terminal_id, data)
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


def _run_key(path, name):
    # NUL can never appear in a real path or config name, so it's a safe
    # separator for composite keys — lets the same project run several
    # configs at once instead of one run clobbering the whole project's slot.
    return f"{path}\x00{name}"


def _stream_run_terminal(path, name, terminal_id, proc):
    window = webview.windows[0]
    try:
        while proc.isalive():
            try:
                data = proc.read(4096)
            except EOFError:
                break
            if data:
                _append_buffer(terminal_id, data)
                try:
                    window.evaluate_js(
                        f"window.__devhub_onTerminalData && window.__devhub_onTerminalData({json.dumps(terminal_id)}, {json.dumps(data)})"
                    )
                except Exception:
                    pass
    except Exception:
        pass
    _terminals.pop(terminal_id, None)
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


# Local proxy that re-serves a page without its anti-framing headers, so the
# Processus preview pane can display sites that set X-Frame-Options or
# CSP frame-ancestors. Only the top-level HTML document goes through here —
# sub-resources load straight from the origin (they're never frame-blocked),
# which a injected <base href> takes care of.
_proxy_server = None
_proxy_port = None
_STRIPPED_HEADERS = {"x-frame-options", "content-security-policy", "content-security-policy-report-only"}


class _ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # keep the app's stdout clean

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        target = urllib.parse.parse_qs(parsed.query).get("url", [None])[0]
        if not target:
            self.send_error(400, "missing url")
            return
        if urllib.parse.urlparse(target).scheme not in ("http", "https"):
            # Refuse file:// and friends — this listens on localhost but there
            # is no reason for it to read the disk.
            self.send_error(400, "unsupported scheme")
            return

        try:
            req = urllib.request.Request(
                target,
                headers={
                    "User-Agent": self.headers.get("User-Agent", "Mozilla/5.0"),
                    "Accept": self.headers.get("Accept", "text/html"),
                    # No gzip: we may need to rewrite the body as text.
                    "Accept-Encoding": "identity",
                },
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = resp.read()
                content_type = resp.headers.get("Content-Type", "text/html")
                status = resp.status
        except urllib.error.HTTPError as e:
            body, content_type, status = e.read(), e.headers.get("Content-Type", "text/html"), e.code
        except Exception as e:
            self.send_error(502, f"proxy error: {e}")
            return

        if "text/html" in content_type.lower():
            base = f"{urllib.parse.urlparse(target).scheme}://{urllib.parse.urlparse(target).netloc}"
            tag = f'<base href="{base}/">'.encode()
            lowered = body.lower()
            head = lowered.find(b"<head")
            if head != -1:
                insert = lowered.find(b">", head) + 1
                body = body[:insert] + tag + body[insert:]
            else:
                body = tag + body

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _ensure_proxy():
    global _proxy_server, _proxy_port
    if _proxy_server:
        return _proxy_port
    _proxy_server = ThreadingHTTPServer(("127.0.0.1", 0), _ProxyHandler)
    _proxy_port = _proxy_server.server_address[1]
    threading.Thread(target=_proxy_server.serve_forever, daemon=True).start()
    return _proxy_port


def load_config():
    if CONFIG_PATH.exists():
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    else:
        config = {"repos": []}
    config.setdefault("repos", [])
    config.setdefault("groups", [])

    changed = False
    for repo in config["repos"]:
        alias = STALE_IDE_ALIASES.get(repo.get("ide"))
        if alias:
            repo["ide"] = alias
            changed = True

    ai = config.get("ai")
    if ai and ai.get("provider") == "claude-code" and ai.get("cli_command", "").strip() == "claude -p":
        ai["cli_command"] = FASTER_CLAUDE_CLI
        changed = True

    if changed:
        save_config(config)

    return config


def save_config(config):
    CONFIG_PATH.write_text(json.dumps(config, indent=2), encoding="utf-8")


def detect_default_ide(path: str) -> str:
    return "idea1"


def run_git(path, *args):
    result = subprocess.run(
        ["git", "-C", path, *args],
        capture_output=True,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    return result.stdout.strip(), result.stderr.strip(), result.returncode


def _safe_repo_file(path, file):
    if not file:
        return False
    repo_path = Path(path).resolve()
    target = (repo_path / file).resolve()
    return repo_path in target.parents


class Api:
    def list_repos(self):
        config = load_config()
        return [self._repo_info(repo) for repo in config["repos"]]

    def _repo_info(self, repo):
        path = repo["path"]
        name = repo.get("name") or Path(path).name
        return {**repo, "name": name, "status": self.git_status(path)}

    def add_repo(self, path, ide=None):
        if not path:
            return {"error": "Chemin vide"}
        config = load_config()
        if any(r["path"] == path for r in config["repos"]):
            return {"error": "Repo déjà ajouté"}
        if not (Path(path) / ".git").exists():
            return {"error": "Pas un dépôt git"}
        entry = {"path": path, "ide": ide or detect_default_ide(path)}
        config["repos"].append(entry)
        save_config(config)
        return self._repo_info(entry)

    def scan_folder(self, root):
        if not root:
            return {"error": "Chemin vide"}
        root_path = Path(root)
        if not root_path.exists():
            return {"error": "Dossier introuvable"}

        config = load_config()
        existing = {r["path"] for r in config["repos"]}
        added = []

        candidates = [root_path, *sorted(p for p in root_path.iterdir() if p.is_dir())]
        for entry in candidates:
            if (entry / ".git").exists():
                path_str = str(entry)
                if path_str in existing:
                    continue
                config["repos"].append({"path": path_str, "ide": detect_default_ide(path_str)})
                existing.add(path_str)
                added.append(path_str)

        save_config(config)
        return {"added": len(added), "repos": added}

    def remove_repo(self, path):
        config = load_config()
        config["repos"] = [r for r in config["repos"] if r["path"] != path]
        for group in config["groups"]:
            group["repos"] = [p for p in group["repos"] if p != path]
        save_config(config)
        return {"ok": True}

    def list_groups(self):
        config = load_config()
        return [{"name": g["name"], "repos": g["repos"], "count": len(g["repos"])} for g in config["groups"]]

    def create_group(self, name):
        name = (name or "").strip()
        if not name:
            return {"error": "Nom de groupe vide"}
        config = load_config()
        if any(g["name"] == name for g in config["groups"]):
            return {"error": "Groupe déjà existant"}
        config["groups"].append({"name": name, "repos": []})
        save_config(config)
        return {"ok": True, "name": name}

    def delete_group(self, name):
        config = load_config()
        config["groups"] = [g for g in config["groups"] if g["name"] != name]
        save_config(config)
        return {"ok": True}

    def rename_group(self, old_name, new_name):
        new_name = (new_name or "").strip()
        if not new_name:
            return {"error": "Nom de groupe vide"}
        config = load_config()
        if any(g["name"] == new_name for g in config["groups"]):
            return {"error": "Un groupe porte déjà ce nom"}
        group = next((g for g in config["groups"] if g["name"] == old_name), None)
        if not group:
            return {"error": "Groupe introuvable"}
        group["name"] = new_name
        save_config(config)
        return {"ok": True, "name": new_name}

    def group_repos(self, name):
        config = load_config()
        group = next((g for g in config["groups"] if g["name"] == name), None)
        if not group:
            return {"error": "Groupe introuvable"}
        by_path = {r["path"]: r for r in config["repos"]}
        return [self._repo_info(by_path[p]) for p in group["repos"] if p in by_path]

    def add_repo_to_group(self, name, path):
        config = load_config()
        group = next((g for g in config["groups"] if g["name"] == name), None)
        if not group:
            return {"error": "Groupe introuvable"}
        # A project belongs to one group at a time — joining a new one
        # reassigns it instead of piling up memberships, since the rest of
        # the UI (Projets sections, group badges, Stats) only ever shows a
        # single group per project and would silently hide it from any
        # group beyond the first otherwise.
        for g in config["groups"]:
            if g is not group and path in g["repos"]:
                g["repos"].remove(path)
        if path not in group["repos"]:
            group["repos"].append(path)
        save_config(config)
        return {"ok": True}

    def remove_repo_from_group(self, name, path):
        config = load_config()
        group = next((g for g in config["groups"] if g["name"] == name), None)
        if not group:
            return {"error": "Groupe introuvable"}
        group["repos"] = [p for p in group["repos"] if p != path]
        save_config(config)
        return {"ok": True}

    def pick_folder(self):
        result = webview.windows[0].create_file_dialog(webview.FileDialog.FOLDER)
        return result[0] if result else None

    def git_status(self, path):
        out, err, code = run_git(path, "status", "--porcelain=v2", "--branch")
        if code != 0:
            return {"error": err or "git status a échoué"}

        branch = None
        ahead = 0
        behind = 0
        dirty = 0
        untracked = 0
        conflicted = []
        files = []

        for line in out.splitlines():
            if line.startswith("# branch.head"):
                branch = line.split(" ")[-1]
            elif line.startswith("# branch.ab"):
                parts = line.split(" ")
                ahead = int(parts[-2].replace("+", ""))
                behind = int(parts[-1].replace("-", ""))
            elif line.startswith("?"):
                untracked += 1
                files.append({"path": line[2:], "status": "?"})
            elif line.startswith("u "):
                parts = line.split(" ", 10)
                p = parts[10]
                conflicted.append(p)
                files.append({"path": p, "status": "U"})
            elif line.startswith("1 "):
                dirty += 1
                parts = line.split(" ", 8)
                files.append({"path": parts[8], "status": parts[1]})
            elif line.startswith("2 "):
                dirty += 1
                parts = line.split(" ", 9)
                files.append({"path": parts[9].split("\t")[0], "status": parts[1]})

        return {
            "branch": branch,
            "ahead": ahead,
            "behind": behind,
            "dirty": dirty,
            "untracked": untracked,
            "conflicted": conflicted,
            "clean": dirty == 0 and untracked == 0 and not conflicted,
            "files": files,
        }

    def abort_merge(self, path):
        out, err, code = run_git(path, "merge", "--abort")
        if code != 0:
            return {"error": err or out}
        return {"ok": True}

    def mark_resolved(self, path, file):
        if not _safe_repo_file(path, file):
            return {"error": "Chemin de fichier invalide"}
        out, err, code = run_git(path, "add", "--", file)
        if code != 0:
            return {"error": err or out}
        return {"ok": True}

    def get_conflict_versions(self, path, file):
        if not _safe_repo_file(path, file):
            return {"error": "Chemin de fichier invalide"}

        def show(stage):
            out, err, code = run_git(path, "show", f":{stage}:{file}")
            return out if code == 0 else None

        file_path = Path(path) / file
        current = ""
        if file_path.exists():
            current = file_path.read_text(encoding="utf-8", errors="replace")

        return {"ours": show(2), "theirs": show(3), "current": current}

    def save_conflict_resolution(self, path, file, content):
        if not _safe_repo_file(path, file):
            return {"error": "Chemin de fichier invalide"}
        file_path = Path(path) / file
        file_path.write_text(content, encoding="utf-8")
        out, err, code = run_git(path, "add", "--", file)
        if code != 0:
            return {"error": err or out}
        return {"ok": True}

    def list_cli_tools(self):
        # Same "only show what's actually there" principle as list_ides,
        # applied to the AI CLI providers (Claude Code, Codex).
        return {"claude": bool(shutil.which("claude")), "codex": bool(shutil.which("codex"))}

    def test_cli_auth(self, cli_command):
        # A cheap, fast round-trip so a broken login shows up in ~2s instead
        # of only surfacing after a real generation sits through the full
        # diff + a 90s timeout — headless (`-p`) mode can fail with a stale
        # OAuth token even while an interactive `claude` session looks fine,
        # since the two don't necessarily share the same refresh path.
        try:
            reply = _call_cli(cli_command, "Reply with exactly: OK", str(APP_DATA_DIR))
        except Exception as e:
            return {"ok": False, "error": str(e)}
        return {"ok": True, "reply": reply[:200]}

    def list_ides(self):
        # Like Windows Explorer's "Open with" — only offer what actually
        # resolves to a launcher on this machine, not every known IDE name.
        return [ide for ide in KNOWN_IDES if shutil.which(ide)]

    def _git_bash_launcher(self):
        # `bash.exe` resolves via PATH (usr/bin/bash.exe) but launching it
        # directly in a plain Windows console comes up broken/garbled — MSYS
        # needs the real git-bash.exe launcher, which sets up its console
        # properly and isn't normally on PATH itself. It lives one level up
        # from wherever git.exe's bin/cmd folder is.
        git = shutil.which("git")
        if git:
            for parent in Path(git).resolve().parents:
                candidate = parent / "git-bash.exe"
                if candidate.exists():
                    return str(candidate)
        for candidate in (r"C:\Program Files\Git\git-bash.exe", r"C:\Program Files (x86)\Git\git-bash.exe"):
            if Path(candidate).exists():
                return candidate
        return None

    def list_terminals(self):
        # cmd and PowerShell ship with every Windows install; Git Bash only
        # exists if Git for Windows is installed.
        terminals = ["cmd", "powershell"]
        if self._git_bash_launcher():
            terminals.append("bash")
        return terminals

    def open_terminal(self, path, kind="cmd"):
        if not Path(path).is_dir():
            return {"error": "Dossier introuvable"}
        try:
            if kind == "powershell":
                subprocess.Popen(["powershell.exe", "-NoExit"], cwd=path, creationflags=subprocess.CREATE_NEW_CONSOLE)
            elif kind == "bash":
                git_bash = self._git_bash_launcher()
                if not git_bash:
                    return {"error": "Git Bash introuvable"}
                subprocess.Popen([git_bash], cwd=path, creationflags=subprocess.CREATE_NEW_CONSOLE)
            else:
                subprocess.Popen(["cmd.exe"], cwd=path, creationflags=subprocess.CREATE_NEW_CONSOLE)
        except Exception as e:
            return {"error": str(e)}
        return {"ok": True}

    def open_in_ide(self, path, ide=None):
        # A bare exception here would reach the js_api dispatcher unhandled;
        # depending on the pywebview/WebView2 version that can leave the JS
        # promise pending forever instead of rejecting it, so the "Ouvrir"
        # button spins indefinitely with no way to recover short of
        # reloading the whole window. Catching everything here guarantees
        # the frontend always gets a real answer to unblock its own state.
        try:
            return self._open_in_ide_impl(path, ide)
        except Exception as e:
            return {"error": f"Erreur inattendue à l'ouverture de l'IDE : {e}"}

    def _open_in_ide_impl(self, path, ide=None):
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        launcher = ide or (repo["ide"] if repo else detect_default_ide(path))

        now = time.monotonic()
        last = _last_launch_at.get(launcher, 0)
        if now - last < IDE_LAUNCH_COOLDOWN_SECONDS:
            wait = round(IDE_LAUNCH_COOLDOWN_SECONDS - (now - last), 1)
            return {"error": f"{launcher} est en train de démarrer, réessaie dans {wait}s.", "log": f"Lancement {launcher} ignoré (cooldown)"}

        exe_name = IDE_PROCESS_NAMES.get(launcher)
        was_running = bool(exe_name and _is_process_running(exe_name))

        if was_running and exe_name:
            # A hung existing instance is exactly what triggers JetBrains' own
            # DirectoryLock$CannotActivateException when we try to relaunch it
            # for a different project — Windows can tell us it's hung before
            # we even attempt that, so kill it and start fresh instead of
            # letting that crash happen.
            hwnd = _find_any_window(exe_name)
            if hwnd and _is_hung_window(hwnd):
                subprocess.run(
                    ["taskkill", "/F", "/IM", exe_name],
                    capture_output=True,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
                time.sleep(0.5)
                was_running = False
            # If this exact project already has a window open, just focus it —
            # relaunching a running JetBrains IDE can trigger their own
            # DirectoryLock$CannotActivateException bug when the running
            # instance is busy/unresponsive, so avoid that relaunch entirely
            # when we don't actually need to open a different project.
            elif _bring_to_front(exe_name, title_hint=Path(path).name, require_title_match=True):
                return {
                    "ok": True,
                    "log": f"{launcher} déjà ouvert sur ce projet — fenêtre remise au premier plan.",
                    "already_running": True,
                }
            elif _ide_ipc_is_broken(launcher):
                # Relaunching now would just produce JetBrains' "still running
                # and does not respond" dialog. Say so instead, and offer the
                # only thing that actually fixes it.
                return {
                    "error": (
                        f"{launcher} tourne mais son canal interne est absent (fichier .port manquant), "
                        f"il ne peut pas ouvrir un autre projet. Redémarre l'IDE pour rétablir."
                    ),
                    "log": f"{launcher} : canal IPC absent, lancement évité",
                    "ide_restart_required": launcher,
                }

        # Different (or no) project currently open — invoke the launcher with
        # the target path. JetBrains launchers forward the path to the
        # existing instance over IPC, which is what actually opens the right
        # project instead of just refocusing whatever was already open.
        try:
            subprocess.Popen([launcher, path], shell=True, creationflags=subprocess.CREATE_NO_WINDOW)
            _last_launch_at[launcher] = now
            if ide and repo:
                repo["ide"] = ide
                save_config(config)
        except FileNotFoundError:
            return {
                "error": f"Launcher '{launcher}' introuvable. Génère les scripts shell depuis JetBrains Toolbox (Settings > Generate shell scripts).",
                "log": f"Échec lancement {launcher} : introuvable",
            }

        if was_running and exe_name:
            # Give the running instance a moment to process the IPC and
            # raise its own window before we try to force focus ourselves —
            # Windows' foreground-lock can block JetBrains' own activation.
            time.sleep(0.6)
            brought_front = _bring_to_front(exe_name, title_hint=Path(path).name)
            return {
                "ok": True,
                "log": f"{launcher} — projet ouvert dans l'instance existante"
                + ("" if brought_front else " (bascule vers sa fenêtre si besoin : Alt+Tab)")
                + ".",
                "already_running": True,
            }

        return {"ok": True, "log": f"{launcher} lancé pour {Path(path).name}"}

    def commit(self, path, message):
        if not message:
            return {"error": "Message de commit vide"}
        out, err, code = run_git(path, "add", "-A")
        if code != 0:
            return {"error": err}
        out, err, code = run_git(path, "commit", "-m", message)
        if code != 0:
            return {"error": err or out}
        return {"ok": True}

    def push(self, path):
        out, err, code = run_git(path, "push")
        if code != 0:
            return {"error": "\n".join(filter(None, [out, err]))}
        return {"ok": True}

    def pull(self, path):
        out, err, code = run_git(path, "pull")
        if code != 0:
            status = self.git_status(path)
            conflicted = status.get("conflicted", [])
            message = "\n".join(filter(None, [out, err]))
            if conflicted:
                return {
                    "error": f"Conflit sur {len(conflicted)} fichier(s) : {', '.join(conflicted)}",
                    "conflicted": conflicted,
                }
            return {"error": message}
        return {"ok": True}

    def global_search(self, query):
        query = (query or "").strip().lower()
        if not query:
            return {"results": []}

        results = []
        for repo in load_config()["repos"]:
            path = repo["path"]
            files = []
            out, _err, code = run_git(path, "ls-files")
            if code == 0:
                for f in out.splitlines():
                    if query in f.lower():
                        files.append(f)
                        if len(files) >= 30:
                            break

            branches = []
            out, _err, code = run_git(path, "branch", "--all", "--format=%(refname:short)")
            if code == 0:
                branches = [b for b in out.splitlines() if b and query in b.lower()]

            if files or branches:
                results.append({"path": path, "name": Path(path).name, "files": files, "branches": branches})

        return {"results": results}

    def branches(self, path):
        out, err, code = run_git(path, "branch", "--all", "--format=%(refname:short)")
        if code != 0:
            return {"error": err}
        return [b for b in out.splitlines() if b]

    def switch_branch(self, path, branch):
        out, err, code = run_git(path, "switch", branch)
        if code != 0:
            return {"error": err}
        return {"ok": True}

    def merge_branch(self, path, branch):
        # Refresh remote-tracking refs first so merging "origin/x" pulls in
        # its latest commits instead of whatever was fetched last.
        if branch.startswith("origin/") or "/" in branch:
            run_git(path, "fetch", "--all")
        out, err, code = run_git(path, "merge", branch)
        if code != 0:
            status = self.git_status(path)
            conflicted = status.get("conflicted", [])
            message = "\n".join(filter(None, [out, err]))
            if conflicted:
                return {
                    "error": f"Conflit sur {len(conflicted)} fichier(s) : {', '.join(conflicted)}",
                    "conflicted": conflicted,
                }
            return {"error": message}
        return {"ok": True}

    def list_run_configs(self, path):
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        return repo.get("runs", []) if repo else []

    def save_run_config(self, path, name, command, env=None, url=None):
        name = (name or "").strip()
        command = (command or "").strip()
        if not name or not command:
            return {"error": "Nom et commande requis"}
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        if not repo:
            return {"error": "Repo introuvable"}
        repo.setdefault("runs", [])
        entry = {"name": name, "command": command, "env": env or {}, "url": (url or "").strip()}
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
            # cmd /c (not an interactive shell we then type into) so the pty's
            # lifetime tracks the actual command: Ctrl+C-ing the dev server
            # ends the whole session instead of leaving a live empty shell
            # behind that still looks "running" to the rest of the app.
            proc = winpty.PtyProcess.spawn(["cmd.exe", "/c", run_cfg["command"]], cwd=path, env=env, dimensions=(24, 80))
        except Exception as e:
            return {"error": str(e)}

        terminal_id = str(uuid.uuid4())
        _terminals[terminal_id] = proc
        _running[key] = {"terminal_id": terminal_id, "config": name, "path": path}
        threading.Thread(target=_stream_run_terminal, args=(path, name, terminal_id, proc), daemon=True).start()
        return {"ok": True, "terminal_id": terminal_id}

    def stop_run(self, path, name):
        entry = _running.get(_run_key(path, name))
        if not entry:
            return {"error": "Rien en cours"}
        proc = _terminals.get(entry.get("terminal_id"))
        if proc:
            # cmd.exe spawns the real dev server (npm -> node, etc.) as a
            # child; closing just the pty leaves that child running as an
            # orphan. Killing the whole process tree by pid stops it too.
            try:
                subprocess.run(
                    ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                    capture_output=True,
                    timeout=10,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
            except Exception:
                pass
            try:
                proc.close(force=True)
            except Exception:
                pass
        return {"ok": True}

    def find_orphan_processes(self):
        config = load_config()
        repo_paths = [r["path"] for r in config["repos"]]
        if not repo_paths:
            return []

        try:
            result = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "Get-CimInstance Win32_Process | "
                    "Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
                ],
                capture_output=True,
                text=True,
                timeout=15,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            processes = json.loads(result.stdout or "[]")
            if isinstance(processes, dict):
                processes = [processes]
        except Exception:
            return []

        children_by_parent = {}
        for p in processes:
            children_by_parent.setdefault(p.get("ParentProcessId"), []).append(p.get("ProcessId"))

        def descendants_of(root_pid):
            found = set()
            stack = [root_pid]
            while stack:
                current = stack.pop()
                for child_pid in children_by_parent.get(current, []):
                    if child_pid not in found:
                        found.add(child_pid)
                        stack.append(child_pid)
            return found

        # Exclude the whole tree of every process Dev Hub is actively tracking as
        # running, not just its direct PID — otherwise its own npm/node children
        # get flagged as "orphans" even though the run is perfectly alive.
        tracked_pids = set()
        for entry in _running.values():
            proc = _terminals.get(entry.get("terminal_id"))
            root = getattr(proc, "pid", None) if proc else None
            if root:
                tracked_pids.add(root)
                tracked_pids |= descendants_of(root)

        candidates = {}
        for proc in processes:
            pid = proc.get("ProcessId")
            cmdline = proc.get("CommandLine") or ""
            name = (proc.get("Name") or "").lower()
            if not pid or pid in tracked_pids or name not in ("node.exe", "cmd.exe"):
                continue
            for repo_path in repo_paths:
                if repo_path.lower() in cmdline.lower():
                    candidates[pid] = {
                        "pid": pid,
                        "ppid": proc.get("ParentProcessId"),
                        "name": proc.get("Name"),
                        "command": cmdline,
                        "repo_path": repo_path,
                    }
                    break

        # One orphan tree (cmd -> npm -> node -> worker) matches at every level;
        # keep only each tree's root so it shows up once instead of duplicated.
        orphans = []
        for pid, info in candidates.items():
            if info["ppid"] in candidates:
                continue
            orphans.append(
                {
                    "pid": info["pid"],
                    "name": info["name"],
                    "command": info["command"],
                    "repo_path": info["repo_path"],
                    "repo_name": Path(info["repo_path"]).name,
                }
            )
        return orphans

    def get_process_stats(self):
        global _psutil_procs
        seen_pids = set()
        results = []

        for key, entry in _running.items():
            proc = _terminals.get(entry.get("terminal_id"))
            root_pid = getattr(proc, "pid", None) if proc else None
            if not root_pid:
                continue
            try:
                root = psutil.Process(root_pid)
                tree = [root] + root.children(recursive=True)
            except psutil.NoSuchProcess:
                continue

            cpu = 0.0
            mem = 0
            alive = 0
            for p in tree:
                cached = _psutil_procs.get(p.pid)
                if cached is None:
                    # First time seeing this pid: prime the delta tracker and
                    # skip its CPU contribution *this* round. Calling
                    # cpu_percent(None) twice back-to-back (prime, then
                    # immediately read for the total) measures against an
                    # ~0ms window, which is exactly what was spiking every
                    # fresh process to ~100% on its very first poll.
                    try:
                        p.cpu_percent(None)
                        mem += p.memory_info().rss
                        alive += 1
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        continue
                    _psutil_procs[p.pid] = p
                    seen_pids.add(p.pid)
                    continue
                seen_pids.add(p.pid)
                try:
                    # Raw psutil cpu_percent is "% of one core" (can exceed
                    # 100 on multi-core work) — dividing by the core count
                    # matches the intuitive Task Manager-style 0-100 reading.
                    cpu += cached.cpu_percent(None) / _CPU_COUNT
                    mem += cached.memory_info().rss
                    alive += 1
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue

            results.append(
                {
                    "path": entry["path"],
                    "config": entry["config"],
                    "cpu_percent": round(cpu, 1),
                    "memory_mb": round(mem / (1024 * 1024), 1),
                    "process_count": alive,
                }
            )

        # Drop cached Process objects for pids that no longer exist — otherwise
        # this dict grows forever across a long session of starting/stopping runs.
        _psutil_procs = {pid: p for pid, p in _psutil_procs.items() if pid in seen_pids}
        return results

    def kill_orphan(self, pid):
        try:
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def kill_orphans(self, pids):
        for pid in pids:
            try:
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
            except Exception:
                pass
        return {"ok": True}

    def _stale_webview_temp_dirs(self):
        # Every launch, WebView2 makes pywebview create a fresh `tmp*`
        # profile dir under %TEMP% and never cleans the old ones up on its
        # own — they silently pile up (100 dirs / ~2.3GB observed here).
        # The current run's own dir is still open/locked, so it's naturally
        # skipped rather than needing to be excluded explicitly.
        tmp = Path(os.environ.get("TEMP") or os.environ.get("TMP") or "")
        if not tmp.is_dir():
            return []
        return [d for d in tmp.glob("tmp*") if (d / "EBWebView").is_dir()]

    def clean_stale_webview_temp(self):
        removed = 0
        failed = 0
        for d in self._stale_webview_temp_dirs():
            try:
                shutil.rmtree(d)
                removed += 1
            except Exception:
                failed += 1
        return {"removed": removed, "failed": failed}

    def list_env_files(self, path):
        p = Path(path)
        if not p.exists():
            return []
        return sorted(f.name for f in p.iterdir() if f.is_file() and f.name.startswith(".env"))

    def _env_file_path(self, path, filename):
        if not filename or not filename.startswith(".env") or "/" in filename or "\\" in filename:
            return None
        return Path(path) / filename

    def read_env_file(self, path, filename):
        file_path = self._env_file_path(path, filename)
        if not file_path:
            return {"error": "Nom de fichier invalide"}
        if not file_path.exists():
            return {"entries": []}

        entries = []
        for line in file_path.read_text(encoding="utf-8", errors="replace").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith(("#", ";")) or "=" not in stripped:
                continue
            key, _, value = stripped.partition("=")
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            entries.append({"key": key, "value": value})
        return {"entries": entries}

    def create_env_file(self, path, filename=".env"):
        file_path = self._env_file_path(path, filename)
        if not file_path:
            return {"error": "Nom de fichier invalide"}
        if not file_path.exists():
            file_path.write_text("", encoding="utf-8")
        return {"ok": True}

    def write_env_file(self, path, filename, entries):
        file_path = self._env_file_path(path, filename)
        if not file_path:
            return {"error": "Nom de fichier invalide"}

        existing_lines = file_path.read_text(encoding="utf-8").splitlines() if file_path.exists() else []
        remaining = {e["key"]: e["value"] for e in entries if e.get("key")}
        output_lines = []

        for line in existing_lines:
            stripped = line.strip()
            if stripped and not stripped.startswith(("#", ";")) and "=" in stripped:
                key = stripped.split("=", 1)[0].strip()
                if key in remaining:
                    output_lines.append(f"{key}={remaining.pop(key)}")
                continue
            output_lines.append(line)

        for key, value in remaining.items():
            output_lines.append(f"{key}={value}")

        file_path.write_text("\n".join(output_lines) + "\n", encoding="utf-8")
        return {"ok": True}

    IGNORE_FILE_NAMES = (".gitignore", ".dockerignore")

    def _ignore_file_path(self, path, filename):
        if filename not in self.IGNORE_FILE_NAMES:
            return None
        return Path(path) / filename

    def list_ignore_files(self, path):
        p = Path(path)
        return {name: (p / name).exists() for name in self.IGNORE_FILE_NAMES}

    def read_ignore_file(self, path, filename):
        file_path = self._ignore_file_path(path, filename)
        if not file_path:
            return {"error": "Nom de fichier invalide"}
        if not file_path.exists():
            return {"content": ""}
        return {"content": file_path.read_text(encoding="utf-8", errors="replace")}

    def write_ignore_file(self, path, filename, content):
        file_path = self._ignore_file_path(path, filename)
        if not file_path:
            return {"error": "Nom de fichier invalide"}
        text = content or ""
        if text and not text.endswith("\n"):
            text += "\n"
        file_path.write_text(text, encoding="utf-8")
        return {"ok": True}

    def count_tracked_matches(self, path, pattern):
        # Lets the UI show "this affects N tracked files" before the user
        # confirms an ignore+untrack — typing a stray single character
        # otherwise gives no clue whether it matches nothing or half the repo.
        if not _safe_repo_file(path, pattern):
            return {"error": "Chemin de fichier invalide"}
        out, err, code = run_git(path, "ls-files", "--", pattern)
        if code != 0:
            return {"error": err or "git ls-files a échoué"}
        files = [f for f in out.splitlines() if f]
        return {"count": len(files), "sample": files[:5]}

    def add_to_ignore(self, path, filename, pattern, untrack=False):
        if not _safe_repo_file(path, pattern):
            return {"error": "Chemin de fichier invalide"}
        file_path = self._ignore_file_path(path, filename)
        if not file_path:
            return {"error": "Nom de fichier invalide"}

        existing = file_path.read_text(encoding="utf-8", errors="replace").splitlines() if file_path.exists() else []
        if pattern not in [line.strip() for line in existing]:
            existing.append(pattern)
            file_path.write_text("\n".join(existing) + "\n", encoding="utf-8")

        if untrack:
            # .gitignore only hides untracked files — a file git already
            # tracks keeps showing as modified until it's untracked too.
            out, err, code = run_git(path, "rm", "--cached", "-r", "--", pattern)
            if code != 0:
                return {"error": err or out}
        return {"ok": True}

    # Theme lives in config.json rather than localStorage: the packaged app
    # is served from a file:// origin, where WebView2's storage isn't a
    # dependable place to keep a preference across restarts.
    def get_config_path(self):
        return {"path": str(CONFIG_PATH)}

    def check_for_update(self):
        # Windows can't let a running .exe overwrite itself, so this only
        # ever surfaces a notification + a link to the release — the user
        # downloads and replaces it themselves, no auto-download/relaunch.
        try:
            data = _get_json(
                f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
                headers={"Accept": "application/vnd.github+json", "User-Agent": "DevHub"},
            )
            latest_tag = data.get("tag_name", "")
            if not latest_tag:
                return {"update_available": False}
            latest = _parse_semver(latest_tag)
            current = _parse_semver(APP_VERSION)
            return {
                "update_available": latest > current,
                "current_version": APP_VERSION,
                "latest_version": latest_tag,
                "url": data.get("html_url") or f"https://github.com/{GITHUB_REPO}/releases/latest",
            }
        except Exception:
            # No internet, no releases published yet, rate-limited, etc. —
            # never let this interrupt normal startup.
            return {"update_available": False}

    def get_theme(self):
        return {"theme": load_config().get("theme", "dark")}

    def set_theme(self, theme):
        config = load_config()
        config["theme"] = theme or "dark"
        save_config(config)
        threading.Thread(target=_apply_window_icon, args=(config["theme"],), daemon=True).start()
        return {"ok": True}

    def get_ai_settings(self):
        ai = load_config().get("ai", {})
        return {
            "provider": ai.get("provider", "openai"),
            "base_url": ai.get("base_url", ""),
            "model": ai.get("model", ""),
            "cli_command": ai.get("cli_command", ""),
            "has_key": bool(ai.get("api_key")),
            "commit_language": ai.get("commit_language", "auto"),
        }

    def save_ai_settings(self, provider, api_key, base_url, model, cli_command=None, commit_language=None):
        config = load_config()
        ai = config.get("ai", {})
        ai["provider"] = provider
        if api_key:
            ai["api_key"] = api_key
        ai["base_url"] = base_url or ""
        ai["model"] = model or ""
        ai["cli_command"] = cli_command or ""
        ai["commit_language"] = commit_language or "auto"
        config["ai"] = ai
        save_config(config)
        return {"ok": True}

    def git_log(self, path, limit=50):
        # \x1f (unit separator) can't appear in a commit subject, unlike a
        # plain delimiter like "|" or ":" which real commit messages do use.
        out, err, code = run_git(
            path, "log", f"-{int(limit)}", "--date=iso-strict", "--format=%H\x1f%h\x1f%an\x1f%ad\x1f%s"
        )
        if code != 0:
            return {"error": err or "git log a échoué"}
        commits = []
        for line in out.splitlines():
            parts = line.split("\x1f")
            if len(parts) == 5:
                commits.append({"hash": parts[0], "short": parts[1], "author": parts[2], "date": parts[3], "subject": parts[4]})
        return {"commits": commits}

    def get_diff(self, path):
        out, err, code = run_git(path, "diff", "HEAD")
        if code != 0:
            return {"error": err or "git diff a échoué"}
        if out.strip():
            return {"diff": out[:20000]}

        # `git diff HEAD` never covers untracked files, so a repo that's
        # entirely new files (first commit, or a freshly scanned repo) comes
        # back empty even though there's plenty to describe. Only pay the
        # stage/unstage round-trip in that specific case — staging
        # everything on every call was the fix, but it made generation
        # noticeably slower even for the common "some tracked files
        # modified" case, which the plain diff above already handles fine.
        run_git(path, "add", "-A")
        out, err, code = run_git(path, "diff", "--cached")
        run_git(path, "reset")
        if code != 0:
            return {"error": err or "git diff a échoué"}
        return {"diff": out[:20000]}

    def generate_commit_message(self, path, language=None):
        ai = load_config().get("ai", {})
        provider = ai.get("provider")
        is_cli = provider in ("claude-code", "codex", "cli")
        if not is_cli and not ai.get("api_key"):
            return {"error": "Aucune clé API configurée (voir Paramètres IA)"}

        diff_result = self.get_diff(path)
        if diff_result.get("error"):
            return diff_result
        diff = diff_result.get("diff", "").strip()
        if not diff:
            return {"error": "Aucun changement à décrire"}

        # An explicit call-site language (the quick picker next to the button)
        # overrides the saved default for just this one generation.
        language = language or ai.get("commit_language", "auto")
        language_line = (
            f"Write the message in {COMMIT_LANGUAGE_NAMES.get(language, language)}.\n"
            if language and language != "auto"
            else ""
        )
        prompt = (
            "Generate a git commit message for this diff, following Conventional Commits:\n"
            "- First line: \"<type>(<scope>): <subject>\" in imperative mood, max ~72 chars. "
            "type is one of feat, fix, refactor, perf, chore, docs, style, test, build. "
            "Include a scope in parentheses when a module/feature is clearly identifiable from the diff, "
            "omit the (scope) entirely otherwise.\n"
            "- If the diff spans multiple files or areas in a way the first line can't fully capture, "
            "add a blank line then 2-5 short bullet points (starting with \"-\") summarizing the key changes "
            "per file or area. Skip the body entirely for small, single-purpose changes — don't pad it out.\n"
            "- No markdown formatting (no backticks, no bold), no surrounding quotes.\n"
            + language_line
            + "\nReply with ONLY the commit message.\n\n"
            + diff
        )

        try:
            if is_cli:
                message = _call_cli(ai.get("cli_command"), prompt, path)
            elif provider == "anthropic":
                message = _call_anthropic(ai, prompt)
            else:
                message = _call_openai_compatible(ai, prompt)
        except Exception as e:
            return {"error": str(e)}

        return {"message": message.strip().strip('"')}

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
            proc = winpty.PtyProcess.spawn(argv, cwd=path, env=env, dimensions=(24, 80))
        except Exception as e:
            return {"error": str(e)}

        terminal_id = str(uuid.uuid4())
        _terminals[terminal_id] = proc
        threading.Thread(target=_stream_terminal, args=(terminal_id, proc), daemon=True).start()
        return {"ok": True, "terminal_id": terminal_id}

    def get_terminal_buffer(self, terminal_id):
        return _terminal_buffers.get(terminal_id, "")

    def clear_run_buffer(self, terminal_id):
        _terminal_buffers.pop(terminal_id, None)
        return {"ok": True}

    def copy_to_clipboard(self, text):
        # WebView2 silently swallows navigator.clipboard / execCommand copy
        # under the app's file:// origin (no permission prompt is wired up),
        # so copy goes through the native Win32 clipboard instead.
        # OpenClipboard can transiently fail with "Access is denied" if another
        # process (or the OS itself) briefly holds the clipboard lock — retry.
        last_error = None
        for attempt in range(6):
            try:
                win32clipboard.OpenClipboard()
                try:
                    win32clipboard.EmptyClipboard()
                    win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
                finally:
                    win32clipboard.CloseClipboard()
                return {"ok": True}
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                time.sleep(0.05 * (attempt + 1))
        return {"ok": False, "error": last_error}

    def restart_ide(self, path, ide=None):
        """Close a running IDE and reopen it directly on `path`.

        Recovery for the case where the IDE is up but its single-instance
        channel is missing, so it can't be handed a new project.
        """
        try:
            return self._restart_ide_impl(path, ide)
        except Exception as e:
            return {"error": f"Erreur inattendue au redémarrage de l'IDE : {e}"}

    def _restart_ide_impl(self, path, ide=None):
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        launcher = ide or (repo["ide"] if repo else detect_default_ide(path))
        exe_name = IDE_PROCESS_NAMES.get(launcher)
        if not exe_name:
            return {"error": f"IDE inconnu : {launcher}"}

        # Ask nicely first so the IDE can flush its state; force only if it
        # ignores that, since a hung instance is the usual reason we're here.
        subprocess.run(
            ["taskkill", "/IM", exe_name],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        for _ in range(20):
            time.sleep(0.5)
            if not _is_process_running(exe_name):
                break
        else:
            subprocess.run(
                ["taskkill", "/F", "/IM", exe_name],
                capture_output=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            time.sleep(1)

        try:
            subprocess.Popen([launcher, path], shell=True, creationflags=subprocess.CREATE_NO_WINDOW)
            _last_launch_at[launcher] = time.monotonic()
        except FileNotFoundError:
            return {"error": f"Launcher '{launcher}' introuvable."}
        return {"ok": True, "log": f"{launcher} redémarré sur {Path(path).name}"}

    def proxy_url(self, url):
        if not url:
            return {"error": "URL vide"}
        try:
            port = _ensure_proxy()
        except Exception as e:
            return {"error": f"Proxy indisponible : {e}"}
        return {"url": f"http://127.0.0.1:{port}/?url={urllib.parse.quote(url, safe='')}"}

    def open_external(self, url):
        if not url:
            return {"ok": False, "error": "URL vide"}
        try:
            webbrowser.open(url)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # Frameless window (custom title bar) has no native min/max/close chrome,
    # so the React-drawn buttons drive these directly.
    def minimize_window(self):
        webview.windows[0].minimize()
        return {"ok": True}

    def toggle_maximize_window(self):
        global _window_maximized
        w = webview.windows[0]
        if _window_maximized:
            w.restore()
            _window_maximized = False
        else:
            w.maximize()
            _window_maximized = True
        return {"ok": True, "maximized": _window_maximized}

    def close_window(self):
        webview.windows[0].destroy()
        return {"ok": True}

    def detect_database(self, path):
        parsed = _detect_database(path)
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
            info["database"] = _mongo_db_name(parsed["uri"]) or "(défaut)"
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
        conn_info = _db_connections.get(path) or _detect_database(path)
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

    def db_list_tables(self, path):
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                db = conn[_mongo_db_name(_db_connections[path]["uri"]) or conn.list_database_names()[0]]
                return {"tables": sorted(db.list_collection_names())}
            cur = conn.cursor()
            if engine == "postgres":
                cur.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' ORDER BY table_name"
                )
            elif engine == "mysql":
                cur.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = DATABASE() ORDER BY table_name"
                )
            else:
                cur.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' "
                    "AND name NOT LIKE 'sqlite_%' ORDER BY name"
                )
            tables = [r[0] for r in cur.fetchall()]
            cur.close()
            return {"tables": tables}
        except Exception as e:
            return {"error": str(e)}
        finally:
            conn.close()

    def db_table_schema(self, path, table):
        if not re.match(r"^[a-zA-Z0-9_$.-]+$", table or ""):
            return {"error": "Nom de table invalide"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                return {"columns": [], "pk_column": "_id"}
            columns, pk_column = _fetch_schema(conn, engine, table)
            return {"columns": columns, "pk_column": pk_column}
        except Exception as e:
            return {"error": str(e)}
        finally:
            conn.close()

    def db_read_table(self, path, table, limit=50, offset=0, filters=None):
        if not re.match(r"^[a-zA-Z0-9_$.-]+$", table or ""):
            return {"error": "Nom de table invalide"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                db = conn[_mongo_db_name(_db_connections[path]["uri"]) or conn.list_database_names()[0]]
                coll = db[table]
                mongo_filter = _build_mongo_filter(filters)
                docs = list(coll.find(mongo_filter).skip(offset).limit(limit))
                columns, types = [], {}
                for doc in docs:
                    for key, value in doc.items():
                        if key not in types:
                            columns.append(key)
                            types[key] = type(value).__name__
                rows = [[None if doc.get(c) is None else str(doc.get(c)) for c in columns] for doc in docs]
                return {
                    "columns": [
                        {"name": c, "type": types[c], "family": "text", "is_pk": c == "_id", "fk": None}
                        for c in columns
                    ],
                    "rows": rows,
                    "total": coll.count_documents(mongo_filter),
                    "pk_column": "_id",
                }

            schema_columns, pk_column = _fetch_schema(conn, engine, table)
            valid_columns = {c["name"] for c in schema_columns}
            by_name = {c["name"]: c for c in schema_columns}
            quote = "`" if engine == "mysql" else '"'
            quoted = f"{quote}{table}{quote}"
            placeholder = "?" if engine == "sqlite" else "%s"
            where_sql, where_params = _build_where(engine, valid_columns, filters, placeholder)

            cur = conn.cursor()
            cur.execute(
                f"SELECT * FROM {quoted}{where_sql} LIMIT {placeholder} OFFSET {placeholder}",
                (*where_params, limit, offset),
            )
            names = [d[0] for d in cur.description]
            rows = [[None if v is None else str(v) for v in row] for row in cur.fetchall()]
            cur.execute(f"SELECT COUNT(*) FROM {quoted}{where_sql}", tuple(where_params))
            total = cur.fetchone()[0]
            cur.close()
            return {
                "columns": [
                    {
                        "name": n,
                        "type": by_name.get(n, {}).get("type", ""),
                        "family": by_name.get(n, {}).get("family", "text"),
                        "is_pk": by_name.get(n, {}).get("is_pk", False),
                        "fk": by_name.get(n, {}).get("fk"),
                    }
                    for n in names
                ],
                "rows": rows,
                "total": total,
                "pk_column": pk_column,
            }
        except Exception as e:
            return {"error": str(e)}
        finally:
            conn.close()

    def db_run_query(self, path, sql):
        if not (sql or "").strip():
            return {"error": "Requête vide"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                return {"error": "L'éditeur SQL n'est pas disponible pour MongoDB — utilise le navigateur de collections."}
            cur = conn.cursor()
            cur.execute(sql)
            if cur.description:
                names = [d[0] for d in cur.description]
                fetched = cur.fetchmany(500)
                rows = [[None if v is None else str(v) for v in row] for row in fetched]
                conn.commit()
                cur.close()
                return {
                    "columns": [{"name": n, "type": "", "family": "text", "is_pk": False, "fk": None} for n in names],
                    "rows": rows,
                    "truncated": len(fetched) == 500,
                }
            rowcount = cur.rowcount
            conn.commit()
            cur.close()
            return {"message": f"{rowcount} ligne(s) affectée(s)", "rowcount": rowcount}
        except Exception as e:
            conn.rollback()
            return {"error": str(e)}
        finally:
            conn.close()

    def db_delete_rows(self, path, table, pk_values):
        if not re.match(r"^[a-zA-Z0-9_$.-]+$", table or ""):
            return {"error": "Nom de table invalide"}
        if not pk_values:
            return {"error": "Aucune ligne sélectionnée"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                from bson import ObjectId

                ids = []
                for v in pk_values:
                    try:
                        ids.append(ObjectId(v))
                    except Exception:
                        ids.append(v)
                db = conn[_mongo_db_name(_db_connections[path]["uri"]) or conn.list_database_names()[0]]
                result = db[table].delete_many({"_id": {"$in": ids}})
                return {"ok": True, "deleted": result.deleted_count}

            _schema_columns, pk_column = _fetch_schema(conn, engine, table)
            if not pk_column:
                return {"error": "Pas de clé primaire unique sur cette table — utilise l'éditeur SQL pour supprimer."}
            quote = "`" if engine == "mysql" else '"'
            quoted_table = f"{quote}{table}{quote}"
            quoted_pk = f"{quote}{pk_column}{quote}"
            placeholder = "?" if engine == "sqlite" else "%s"
            placeholders = ", ".join([placeholder] * len(pk_values))
            cur = conn.cursor()
            cur.execute(f"DELETE FROM {quoted_table} WHERE {quoted_pk} IN ({placeholders})", tuple(pk_values))
            deleted = cur.rowcount
            conn.commit()
            cur.close()
            return {"ok": True, "deleted": deleted}
        except Exception as e:
            conn.rollback()
            return {"error": str(e)}
        finally:
            conn.close()

    def db_insert_row(self, path, table, values):
        if not re.match(r"^[a-zA-Z0-9_$.-]+$", table or ""):
            return {"error": "Nom de table invalide"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                db = conn[_mongo_db_name(_db_connections[path]["uri"]) or conn.list_database_names()[0]]
                doc = {k: v for k, v in (values or {}).items() if k and v != ""}
                result = db[table].insert_one(doc)
                return {"ok": True, "id": str(result.inserted_id)}

            schema_columns, _pk_column = _fetch_schema(conn, engine, table)
            by_name = {c["name"]: c for c in schema_columns}
            cols, params = [], []
            for key, raw in (values or {}).items():
                if key not in by_name:
                    continue
                col = by_name[key]
                coerced, err = _coerce_value(raw, col["family"], col["nullable"], col["has_default"])
                if err:
                    return {"error": f'Colonne "{key}" : {err}'}
                if coerced is _SKIP:
                    continue
                cols.append(key)
                params.append(coerced)
            if not cols:
                return {"error": "Aucune valeur à insérer"}
            quote = "`" if engine == "mysql" else '"'
            quoted_table = f"{quote}{table}{quote}"
            quoted_cols = ", ".join(f"{quote}{c}{quote}" for c in cols)
            placeholder = "?" if engine == "sqlite" else "%s"
            placeholders = ", ".join([placeholder] * len(cols))
            cur = conn.cursor()
            cur.execute(f"INSERT INTO {quoted_table} ({quoted_cols}) VALUES ({placeholders})", tuple(params))
            conn.commit()
            cur.close()
            return {"ok": True}
        except Exception as e:
            conn.rollback()
            return {"error": str(e)}
        finally:
            conn.close()

    def db_update_cell(self, path, table, column, value, pk_column, pk_value):
        if not re.match(r"^[a-zA-Z0-9_$.-]+$", table or "") or not re.match(r"^[a-zA-Z0-9_$.-]+$", column or ""):
            return {"error": "Nom invalide"}
        conn, engine, error = self._db_connect(path)
        if error:
            return {"error": error}
        try:
            if engine == "mongo":
                from bson import ObjectId

                try:
                    oid = ObjectId(pk_value)
                except Exception:
                    oid = pk_value
                db = conn[_mongo_db_name(_db_connections[path]["uri"]) or conn.list_database_names()[0]]
                db[table].update_one({"_id": oid}, {"$set": {column: value}})
                return {"ok": True}

            schema_columns, _pk = _fetch_schema(conn, engine, table)
            by_name = {c["name"]: c for c in schema_columns}
            if column not in by_name:
                return {"error": "Colonne inconnue"}
            col = by_name[column]
            # has_default=False: an explicit edit that's left blank means "set
            # NULL" (if nullable), never "leave the DB default alone" like insert.
            coerced, err = _coerce_value(value, col["family"], col["nullable"], False)
            if err:
                return {"error": f'Colonne "{column}" : {err}'}
            quote = "`" if engine == "mysql" else '"'
            quoted_table = f"{quote}{table}{quote}"
            quoted_col = f"{quote}{column}{quote}"
            quoted_pk = f"{quote}{pk_column}{quote}"
            placeholder = "?" if engine == "sqlite" else "%s"
            cur = conn.cursor()
            cur.execute(
                f"UPDATE {quoted_table} SET {quoted_col} = {placeholder} WHERE {quoted_pk} = {placeholder}",
                (coerced, pk_value),
            )
            conn.commit()
            cur.close()
            return {"ok": True}
        except Exception as e:
            conn.rollback()
            return {"error": str(e)}
        finally:
            conn.close()

    def write_terminal(self, terminal_id, data):
        proc = _terminals.get(terminal_id)
        if not proc:
            return {"error": "Session introuvable"}
        try:
            proc.write(data)
        except Exception as e:
            return {"error": str(e)}
        return {"ok": True}

    def resize_terminal(self, terminal_id, rows, cols):
        proc = _terminals.get(terminal_id)
        if not proc:
            return {"error": "Session introuvable"}
        try:
            proc.setwinsize(rows, cols)
        except Exception as e:
            return {"error": str(e)}
        return {"ok": True}

    def close_terminal(self, terminal_id):
        proc = _terminals.pop(terminal_id, None)
        if proc:
            try:
                proc.close(force=True)
            except Exception:
                pass
        return {"ok": True}



def _claude_project_dir(path):
    normalized = str(Path(path).resolve())
    encoded = re.sub(r"[\\/:]", "-", normalized)
    return Path.home() / ".claude" / "projects" / encoded


def _get_json(url, headers=None, timeout=10):
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_semver(tag):
    # Tags are typically "v1.2.3" — strip the leading "v" and pad to 3 parts
    # so "1.2" compares sanely against "1.2.0".
    parts = tag.lstrip("vV").split(".")
    nums = []
    for p in parts[:3]:
        digits = "".join(c for c in p if c.isdigit())
        nums.append(int(digits) if digits else 0)
    while len(nums) < 3:
        nums.append(0)
    return tuple(nums)


def _post_json(url, headers, payload, timeout=30):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} : {detail[:300]}")
    except urllib.error.URLError as e:
        raise RuntimeError(str(e.reason))


def _call_cli(cli_command, prompt, cwd):
    if not cli_command or not cli_command.strip():
        raise RuntimeError("Commande CLI non configurée (voir Paramètres IA)")

    try:
        argv = shlex.split(cli_command, posix=False)
    except ValueError as e:
        raise RuntimeError(f"Commande CLI invalide : {e}")

    try:
        # The prompt (which embeds the full diff, up to 20k chars) must go
        # over stdin rather than as a trailing CLI argument — Windows caps a
        # process's command line around 8191 chars, so a real diff blew past
        # that and failed with "The command line is too long." Both bundled
        # presets (claude -p, codex exec) read the prompt from stdin when no
        # positional argument is given.
        result = subprocess.run(
            argv,
            cwd=cwd,
            shell=True,
            input=prompt,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=90,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except FileNotFoundError:
        raise RuntimeError(f"Commande '{argv[0]}' introuvable dans le PATH.")
    except subprocess.TimeoutExpired:
        raise RuntimeError("La commande CLI a mis trop de temps à répondre.")

    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "La commande CLI a échoué")
    return result.stdout.strip()


def _call_anthropic(ai, prompt):
    model = ai.get("model") or "claude-sonnet-4-5"
    data = _post_json(
        "https://api.anthropic.com/v1/messages",
        {
            "x-api-key": ai["api_key"],
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        {"model": model, "max_tokens": 200, "messages": [{"role": "user", "content": prompt}]},
    )
    return data["content"][0]["text"]


def _default_base_url(provider):
    return {
        "openai": "https://api.openai.com/v1",
        "deepseek": "https://api.deepseek.com",
    }.get(provider, "https://api.openai.com/v1")


def _default_model(provider):
    return {
        "openai": "gpt-4o-mini",
        "deepseek": "deepseek-chat",
    }.get(provider, "gpt-4o-mini")


def _call_openai_compatible(ai, prompt):
    base_url = (ai.get("base_url") or _default_base_url(ai.get("provider"))).rstrip("/")
    model = ai.get("model") or _default_model(ai.get("provider"))
    data = _post_json(
        f"{base_url}/chat/completions",
        {"Authorization": f"Bearer {ai['api_key']}", "content-type": "application/json"},
        {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 200},
    )
    return data["choices"][0]["message"]["content"]


class _MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", wintypes.POINT),
    ]


_WM_HOTKEY = 0x0312
_VK_F11 = 0x7A
_VK_ESCAPE = 0x1B
_F11_HOTKEY_ID = 1
_ESCAPE_HOTKEY_ID = 2
_PM_REMOVE = 1


def _is_window_fullscreen(win):
    from webview.platforms.winforms import BrowserView

    form = BrowserView.instances.get(win.uid)
    return bool(getattr(form, "is_fullscreen", False)) if form else False


def _set_fullscreen(win, value):
    if _is_window_fullscreen(win) == value:
        return
    win.toggle_fullscreen()
    # OS-level fullscreen only hides the Windows taskbar — "like a browser"
    # also means Dev Hub's own chrome (tabs, header buttons) should
    # disappear, which only the frontend can do. There's no pywebview event
    # for this, so the new state is pushed into the page directly;
    # toggle_fullscreen() is synchronous (it Invokes onto the UI thread and
    # blocks until done), so is_fullscreen is already current here.
    is_fs = _is_window_fullscreen(win)
    win.evaluate_js(f"window.dispatchEvent(new CustomEvent('devhub-fullscreen', {{detail: {str(is_fs).lower()}}}))")


def _f11_fullscreen_watch():
    # A page-level JS keydown listener can't catch F11/Escape while focus
    # is inside the Processus preview iframe — that's a separate document,
    # so its key events never reach the parent window's listeners at all.
    # RegisterHotKey with hwnd=None claims the key for the calling
    # *thread* system-wide, which would otherwise steal it from every
    # other app (browsers included, and Escape is far too common a key
    # elsewhere) even while Dev Hub sits in the background — so both are
    # only actually registered while Dev Hub is the foreground window,
    # checked on the same loop that drains the hotkey messages. Escape
    # only ever exits fullscreen, never enters it, so it doesn't fight
    # with Escape's normal JS-side job of closing modals when not
    # fullscreen (a global hotkey firing doesn't suppress the key from
    # still reaching the focused control's own handlers too).
    user32 = ctypes.windll.user32
    msg = _MSG()
    registered = False
    try:
        while True:
            try:
                hwnd = win32gui.FindWindow(None, "Dev Hub")
            except Exception:
                hwnd = None
            focused = bool(hwnd) and win32gui.GetForegroundWindow() == hwnd

            if focused and not registered:
                registered = bool(user32.RegisterHotKey(None, _F11_HOTKEY_ID, 0, _VK_F11))
                registered = bool(user32.RegisterHotKey(None, _ESCAPE_HOTKEY_ID, 0, _VK_ESCAPE)) and registered
            elif not focused and registered:
                user32.UnregisterHotKey(None, _F11_HOTKEY_ID)
                user32.UnregisterHotKey(None, _ESCAPE_HOTKEY_ID)
                registered = False

            while user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, _PM_REMOVE):
                if msg.message != _WM_HOTKEY:
                    continue
                try:
                    win = webview.windows[0]
                    if msg.wParam == _F11_HOTKEY_ID:
                        _set_fullscreen(win, not _is_window_fullscreen(win))
                    elif msg.wParam == _ESCAPE_HOTKEY_ID:
                        _set_fullscreen(win, False)
                except Exception:
                    pass

            time.sleep(0.15)
    finally:
        if registered:
            user32.UnregisterHotKey(None, _F11_HOTKEY_ID)
            user32.UnregisterHotKey(None, _ESCAPE_HOTKEY_ID)


def _kill_all_running():
    for proc in list(_terminals.values()):
        try:
            proc.close(force=True)
        except Exception:
            pass
    _terminals.clear()
    _running.clear()


ICON_DESIGN_VERSION = "v2"


def _theme_icon_path(hex_color):
    # Cached per color under APP_DATA_DIR — regenerating a handful of small
    # PNGs/ICOs on first use per theme is cheap, but there's no reason to
    # redo it on every switch back to an already-seen theme. The version
    # tag means a design change (e.g. v1 -> v2 dropped an extra chevron
    # that didn't match the in-app logo) invalidates old cached files
    # instead of silently keeping the outdated art forever.
    icons_dir = APP_DATA_DIR / "icons"
    icons_dir.mkdir(exist_ok=True)
    ico_path = icons_dir / f"{hex_color.lstrip('#')}-{ICON_DESIGN_VERSION}.ico"
    if ico_path.exists():
        return ico_path

    from PIL import Image, ImageDraw

    size = 256
    accent = tuple(int(hex_color.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4)) + (255,)
    white = (255, 255, 255, 255)

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 4.6, fill=accent)

    # Matches IconLayers (frontend/src/icons.jsx) exactly: a diamond and a
    # single chevron below it — the generated icon used to add a second
    # chevron the in-app logo doesn't have.
    cx = size / 2
    cy = size * 0.40
    hw, hh = size * 0.26, size * 0.15
    draw.polygon([(cx, cy - hh), (cx + hw, cy), (cx, cy + hh), (cx - hw, cy)], fill=white)

    thickness = int(size * 0.05)
    cy = size * 0.66
    hw, hh = size * 0.24, size * 0.10
    draw.line([(cx - hw, cy - hh), (cx, cy), (cx + hw, cy - hh)], fill=white, width=thickness, joint="curve")

    img.save(ico_path, sizes=[(256, 256), (64, 64), (32, 32), (16, 16)])
    return ico_path


def _apply_window_icon(theme, retries=1):
    # pywebview's Windows backend hosts the browser in a .NET WinForms
    # Form, reachable through its internal instance registry — the same
    # object pywebview itself sets `.Icon` on once at startup, so this just
    # does that again later with a different file. Called right at startup,
    # the native form may not exist yet (create_window only registers the
    # config — the WinForms message loop that actually builds it starts
    # inside webview.start()), so a few retries cover that race.
    try:
        from webview.platforms.winforms import BrowserView
        from System import Func, Type
        from System.Drawing import Icon as NetIcon

        win = webview.windows[0]
        form = BrowserView.instances.get(win.uid)
        if not form:
            if retries > 0:
                time.sleep(0.5)
                _apply_window_icon(theme, retries - 1)
            return
        ico_path = _theme_icon_path(THEME_ACCENTS.get(theme, THEME_ACCENTS["dark"]))

        # WinForms controls can only be touched from the thread that created
        # them — this runs from a background thread, so the assignment has
        # to be marshaled onto the UI thread via Invoke, same as pywebview's
        # own minimize()/maximize()/close() do internally. Setting .Icon
        # directly here silently threw (swallowed by the except below) and
        # never actually changed anything.
        def _set_icon():
            form.Icon = NetIcon(str(ico_path))

        form.Invoke(Func[Type](_set_icon))
    except Exception:
        pass


def main():
    api = Api()
    dev_url = os.environ.get("DEV_HUB_DEV_URL")
    if dev_url:
        target = dev_url
    else:
        base = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).parent.parent
        target = str(base / "frontend" / "dist" / "index.html")
    window = webview.create_window(
        "Dev Hub",
        target,
        js_api=api,
        width=1100,
        height=720,
        min_size=(800, 600),
        frameless=True,
        easy_drag=False,
        background_color="#0a0a0c",
    )
    window.events.closing += _kill_all_running

    # Stale WebView2 profile dirs from past launches otherwise only get
    # cleaned when someone happens to open Processus and click the button —
    # the current session's own dir is always skipped (still locked), so
    # there's nothing to lose by doing this unattended on every startup.
    threading.Thread(target=api.clean_stale_webview_temp, daemon=True).start()
    threading.Thread(target=_f11_fullscreen_watch, daemon=True).start()

    # Match the taskbar icon to whichever theme was last saved, rather than
    # leaving it on the default accent until the user happens to switch
    # themes once in this session.
    threading.Thread(target=lambda: _apply_window_icon(load_config().get("theme", "dark"), retries=10), daemon=True).start()

    # Keep pywebview's default private mode: setting private_mode=False with a
    # storage_path broke the JS API bridge in the frozen build (the window
    # rendered but window.pywebview.api never appeared, so nothing loaded).
    webview.start()


if __name__ == "__main__":
    main()

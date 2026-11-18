"""Accounts of the AI agents (Claude Code, Codex): who is logged in right now,
the list of accounts Dev Hub has seen, and switching between them.

Both CLIs keep exactly one login on disk. To offer several accounts, Dev Hub
keeps a private snapshot of each account's login (in its own data folder) and
swaps the live one on request — the same thing as logging out and in again,
without the browser round trip. Only the "who am I" part of the live files is
ever replaced (Claude's credentials file also holds unrelated MCP tokens), and
the live files are backed up before each swap.

The snapshots hold refresh tokens, like the CLIs' own files: they never leave
the backend (the UI only gets e-mail, name and plan).
"""
import base64
import json
import os
import shutil
import time
import uuid
from pathlib import Path

from app_config import APP_DATA_DIR

AGENTS = ("claude-code", "codex")
ACCOUNTS_DIR = APP_DATA_DIR / "ai-accounts"
_BACKUPS_KEPT = 5


# ------------------------------------------------------------- live files


def _claude_dir():
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")


def claude_credentials_path():
    return _claude_dir() / ".credentials.json"


def claude_state_path():
    # Claude Code's global state (holds `oauthAccount`): next to the config
    # dir when CLAUDE_CONFIG_DIR is set, in the home folder otherwise.
    custom = os.environ.get("CLAUDE_CONFIG_DIR")
    return Path(custom) / ".claude.json" if custom else Path.home() / ".claude.json"


def codex_auth_path():
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "auth.json"


def _read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_json_atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    for attempt in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def _jwt_claims(token):
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        return {}


def live_identity(agent):
    """Who the CLI is logged in as right now, or None when logged out."""
    if agent == "claude-code":
        oauth = (_read_json(claude_credentials_path()) or {}).get("claudeAiOauth")
        if not oauth or not oauth.get("accessToken"):
            return None
        acct = (_read_json(claude_state_path()) or {}).get("oauthAccount") or {}
        email = acct.get("emailAddress")
        return {
            "key": acct.get("accountUuid") or email or "claude",
            "email": email,
            "name": acct.get("displayName") or acct.get("fullName"),
            "org": acct.get("organizationName"),
            "plan": oauth.get("subscriptionType"),
        }
    auth = _read_json(codex_auth_path())
    if not auth:
        return None
    tokens = auth.get("tokens") or {}
    if tokens.get("id_token"):
        claims = _jwt_claims(tokens["id_token"])
        info = claims.get("https://api.openai.com/auth") or {}
        email = claims.get("email")
        return {
            "key": f"{email}|{tokens.get('account_id') or info.get('chatgpt_account_id') or ''}",
            "email": email,
            "name": claims.get("name"),
            "org": None,
            "plan": info.get("chatgpt_plan_type"),
        }
    if auth.get("OPENAI_API_KEY"):
        return {"key": "codex-api-key", "email": None, "name": "Clé API OpenAI", "org": None, "plan": "api"}
    return None


def _capture(agent):
    """The secret part of the live login, as a snapshot payload."""
    if agent == "claude-code":
        oauth = (_read_json(claude_credentials_path()) or {}).get("claudeAiOauth")
        if not oauth:
            return None
        return {
            "claudeAiOauth": oauth,
            "oauthAccount": (_read_json(claude_state_path()) or {}).get("oauthAccount"),
        }
    auth = _read_json(codex_auth_path())
    return {"auth": auth} if auth else None


def _apply(agent, payload):
    """Make a snapshot the live login."""
    if agent == "claude-code":
        creds_path = claude_credentials_path()
        creds = _read_json(creds_path) or {}
        creds["claudeAiOauth"] = payload["claudeAiOauth"]
        _write_json_atomic(creds_path, creds)
        state_path = claude_state_path()
        state = _read_json(state_path)
        if state is not None:
            if payload.get("oauthAccount"):
                state["oauthAccount"] = payload["oauthAccount"]
            else:
                state.pop("oauthAccount", None)
            _write_json_atomic(state_path, state)
        return
    _write_json_atomic(codex_auth_path(), payload["auth"])


# ------------------------------------------------------------ saved accounts


def _dir(agent):
    d = ACCOUNTS_DIR / agent
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path(agent):
    return _dir(agent) / "accounts.json"


def _load_index(agent):
    data = _read_json(_index_path(agent))
    return data if isinstance(data, list) else []


def _save_index(agent, accounts):
    _write_json_atomic(_index_path(agent), accounts)


def _payload_path(agent, account_id):
    return _dir(agent) / f"{account_id}.json"


def _save_payload(agent, account_id, payload):
    path = _payload_path(agent, account_id)
    _write_json_atomic(path, payload)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _find(accounts, key):
    return next((a for a in accounts if a.get("key") == key), None)


def find_by_key(agent, key):
    return _find(_load_index(agent), key)


def refresh_active(agent):
    """Save the live login as an account (new) or refresh its snapshot (known:
    the CLI rotates tokens, so the saved copy must follow). Returns the
    account entry, or None when nobody is logged in."""
    ident = live_identity(agent)
    payload = _capture(agent)
    if not ident or not payload:
        return None
    accounts = _load_index(agent)
    entry = _find(accounts, ident["key"])
    now = int(time.time())
    if entry is None:
        entry = {"id": uuid.uuid4().hex[:12], "key": ident["key"], "added_at": now, "label": ""}
        accounts.append(entry)
    entry.update({k: ident.get(k) for k in ("email", "name", "org", "plan")})
    entry["last_used"] = now
    _save_payload(agent, entry["id"], payload)
    _save_index(agent, accounts)
    return entry


def list_accounts(agent):
    live = refresh_active(agent)
    accounts = _load_index(agent)
    return {
        "logged_in": live is not None,
        "accounts": [
            {
                "id": a["id"],
                "email": a.get("email"),
                "name": a.get("name"),
                "org": a.get("org"),
                "plan": a.get("plan"),
                "label": a.get("label") or "",
                "added_at": a.get("added_at"),
                "active": live is not None and a["id"] == live["id"],
            }
            for a in accounts
        ],
    }


def _backup_live(agent):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = _dir(agent) / "_backups" / stamp
    dest.mkdir(parents=True, exist_ok=True)
    files = [claude_credentials_path(), claude_state_path()] if agent == "claude-code" else [codex_auth_path()]
    for f in files:
        if f.exists():
            shutil.copy2(f, dest / f.name)
    backups = sorted(p for p in (dest.parent).iterdir() if p.is_dir())
    for old in backups[:-_BACKUPS_KEPT]:
        shutil.rmtree(old, ignore_errors=True)


def switch(agent, account_id):
    accounts = _load_index(agent)
    target = next((a for a in accounts if a["id"] == account_id), None)
    if target is None:
        return {"error": "Compte introuvable"}
    payload = _read_json(_payload_path(agent, account_id))
    if not payload:
        return {"error": "Les identifiants de ce compte sont introuvables — reconnecte-le."}
    refresh_active(agent)  # keep the account we are leaving up to date
    _backup_live(agent)
    try:
        _apply(agent, payload)
    except (OSError, KeyError) as e:
        return {"error": f"Impossible d'écrire la connexion : {e}"}
    ident = live_identity(agent)
    if not ident or ident["key"] != target["key"]:
        return {"error": "Le changement n'a pas été pris en compte — réessaie."}
    accounts = _load_index(agent)
    for a in accounts:
        if a["id"] == account_id:
            a["last_used"] = int(time.time())
    _save_index(agent, accounts)
    return {"ok": True}


def remove(agent, account_id):
    accounts = _load_index(agent)
    live = live_identity(agent)
    entry = next((a for a in accounts if a["id"] == account_id), None)
    if entry is None:
        return {"error": "Compte introuvable"}
    if live and live["key"] == entry["key"]:
        return {"error": "C'est le compte actif : déconnecte-le plutôt, ou bascule d'abord sur un autre."}
    _save_index(agent, [a for a in accounts if a["id"] != account_id])
    try:
        _payload_path(agent, account_id).unlink()
    except OSError:
        pass
    return {"ok": True}


def forget(agent, key):
    """Drop a saved account by identity key (after a logout)."""
    accounts = _load_index(agent)
    gone = [a for a in accounts if a.get("key") == key]
    _save_index(agent, [a for a in accounts if a.get("key") != key])
    for a in gone:
        try:
            _payload_path(agent, a["id"]).unlink()
        except OSError:
            pass


def rename(agent, account_id, label):
    accounts = _load_index(agent)
    for a in accounts:
        if a["id"] == account_id:
            a["label"] = (label or "").strip()[:40]
            _save_index(agent, accounts)
            return {"ok": True}
    return {"error": "Compte introuvable"}


def running_cli_count(agent):
    """CLI sessions open right now: they keep the login they started with
    (and may write it back), so the UI warns before a switch."""
    try:
        import psutil
    except ImportError:
        return 0
    names = {"claude-code": ("claude",), "codex": ("codex",)}[agent]
    markers = {"claude-code": "@anthropic-ai/claude-code", "codex": "@openai/codex"}[agent]
    count = 0
    for proc in psutil.process_iter(["name", "cmdline"]):
        try:
            stem = Path(proc.info["name"] or "").stem.lower()
            cmd = " ".join(proc.info["cmdline"] or []).lower()
            if stem in names or markers in cmd:
                count += 1
        except Exception:
            continue
    return count

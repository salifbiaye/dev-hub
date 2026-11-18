"""Cross-cutting app config: where it lives on disk, versioning, and the
one-time migrations load_config() applies to older config.json files."""
import json
import os
import time

from core.platform import platform_svc

APP_DATA_DIR = platform_svc.config_dir()
CONFIG_PATH = APP_DATA_DIR / "config.json"

APP_VERSION = "0.10.0"
GITHUB_REPO = "salifbiaye/dev-hub"

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

# CLI-driven providers, each with its own command so Claude Code and Codex
# can both be configured at once; the one picked per action (commit
# message, IA session) falls back to the saved defaults below.
AGENT_PROVIDERS = ("claude-code", "codex", "cli")
# Codex refuses to run outside a git repository ("Not inside a trusted
# directory") unless told otherwise — the "test connection" ping runs from
# Dev Hub's data folder, and a project may not be a repo yet.
CODEX_CLI = "codex exec --skip-git-repo-check"
DEFAULT_CLI_COMMANDS = {"claude-code": FASTER_CLAUDE_CLI, "codex": CODEX_CLI, "cli": ""}
# Commands earlier versions preset, upgraded on read to the current preset.
_OUTDATED_COMMANDS = {"claude-code": ("claude -p",), "codex": ("codex exec",)}


def ai_cli_commands(ai):
    """{provider: command} for every CLI provider. Configs saved before
    per-agent commands existed only have the single `cli_command`, which
    belonged to whichever provider was selected then."""
    stored = ai.get("cli_commands")
    legacy = stored is None
    commands = {}
    for p in AGENT_PROVIDERS:
        cmd = ((stored or {}).get(p) or "").strip()
        if not cmd and legacy and ai.get("provider") == p:
            cmd = (ai.get("cli_command") or "").strip()
        if cmd in _OUTDATED_COMMANDS.get(p, ()):
            cmd = ""
        commands[p] = cmd or DEFAULT_CLI_COMMANDS[p]
    return commands


def _command_binary(command):
    import shlex

    try:
        return shlex.split(command, posix=False)[0].strip('"')
    except (ValueError, IndexError):
        return None


def default_agent(ai):
    """The CLI used when nothing is chosen explicitly (IA sessions, Hubi):
    the saved choice, else the provider if it is a CLI, else the first one
    whose binary is actually installed."""
    import shutil
    from pathlib import Path

    if ai.get("agent") in AGENT_PROVIDERS:
        return ai["agent"]
    if ai.get("provider") in AGENT_PROVIDERS:
        return ai["provider"]
    for p, cmd in ai_cli_commands(ai).items():
        binary = _command_binary(cmd) if cmd else None
        if binary and (shutil.which(binary) or Path(binary).exists()):
            return p
    return "claude-code"


def ai_cli_command(ai, provider=None):
    """Command line of `provider` (default agent when None)."""
    return ai_cli_commands(ai).get(provider or default_agent(ai), "")


def _read_config_file():
    # Dev Hub and Hubi (two processes) share this file and Hubi reads it many
    # times a second: on Windows the atomic replace in save_config() can still
    # make a read fail for a few milliseconds, so retry briefly.
    for attempt in range(10):
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            if attempt == 9:
                raise
            time.sleep(0.02)


def load_config():
    if CONFIG_PATH.exists():
        config = _read_config_file()
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
    if ai and (ai.get("cli_commands") or {}).get("claude-code", "").strip() == "claude -p":
        ai["cli_commands"]["claude-code"] = FASTER_CLAUDE_CLI
        changed = True

    if changed:
        save_config(config)

    return config


def save_config(config):
    # Write then swap: a reader in the other process never sees a half-written
    # (or empty) file. os.replace fails on Windows while a reader has the file
    # open, hence the retries.
    tmp = CONFIG_PATH.with_name(f"config.json.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(config, indent=2), encoding="utf-8")
    for attempt in range(20):
        try:
            os.replace(tmp, CONFIG_PATH)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.02)


def detect_default_ide(path: str) -> str:
    return "idea1"

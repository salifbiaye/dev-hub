"""Cross-cutting app config: where it lives on disk, versioning, and the
one-time migrations load_config() applies to older config.json files."""
import json

from core.platform import platform_svc

APP_DATA_DIR = platform_svc.config_dir()
CONFIG_PATH = APP_DATA_DIR / "config.json"

APP_VERSION = "0.5.0"
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

import base64
import json
import re
import threading
import urllib.error
import urllib.request

import webview

from app_config import APP_VERSION, CONFIG_PATH, GITHUB_REPO, load_config, save_config


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


class ReposSettingsMixin:
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
        import icons
        from features.browser.windows import window as browser_window

        config = load_config()
        config["theme"] = theme or "dark"
        save_config(config)
        threading.Thread(target=icons.apply_window_icon, args=(config["theme"],), daemon=True).start()
        if browser_window._browser_window is not None:
            threading.Thread(target=browser_window.push_theme_to_browser_window, daemon=True).start()
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

    def save_image_file(self, data_url, suggested_name="export.png"):
        m = re.match(r"^data:image/(\w+);base64,(.+)$", data_url or "", re.DOTALL)
        if not m:
            return {"error": "Image invalide"}
        ext, b64 = m.group(1), m.group(2)
        if not suggested_name.lower().endswith(f".{ext}"):
            suggested_name = f"{suggested_name}.{ext}"
        dest = webview.windows[0].create_file_dialog(
            webview.FileDialog.SAVE, save_filename=suggested_name, file_types=(f"Image (*.{ext})",)
        )
        if not dest:
            return {"cancelled": True}
        dest = dest[0] if isinstance(dest, (list, tuple)) else dest
        try:
            with open(dest, "wb") as f:
                f.write(base64.b64decode(b64))
        except Exception as e:
            return {"error": str(e)}
        return {"path": dest}

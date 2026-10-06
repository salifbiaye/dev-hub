"""Shared AI-provider call helpers for commit-message generation and the
"test connection" ping -- not git-specific themselves, but only ever used
from here, so they live alongside their one caller."""
import shlex
import subprocess
import urllib.error
import urllib.request
import json


def call_cli(cli_command, prompt, cwd):
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


def call_anthropic(ai, prompt):
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


def call_openai_compatible(ai, prompt):
    base_url = (ai.get("base_url") or _default_base_url(ai.get("provider"))).rstrip("/")
    model = ai.get("model") or _default_model(ai.get("provider"))
    data = _post_json(
        f"{base_url}/chat/completions",
        {"Authorization": f"Bearer {ai['api_key']}", "content-type": "application/json"},
        {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 200},
    )
    return data["choices"][0]["message"]["content"]

import shutil

from app_config import load_config

from .ai_client import call_anthropic, call_cli, call_openai_compatible
from .run_git import run_git, safe_repo_file

COMMIT_LANGUAGE_NAMES = {
    "fr": "French",
    "en": "English",
    "es": "Spanish",
    "de": "German",
    "pt": "Portuguese",
}


class GitCommitMixin:
    def commit(self, path, message, files=None):
        current = None
        if not message:
            return {"error": "Message de commit vide"}
        # An explicit file selection stages only those paths, so files left
        # unchecked in the commit panel stay untouched (not committed, not
        # even staged) instead of the previous always-`add -A` behavior.
        if files:
            safe_files = [f for f in files if safe_repo_file(path, f)]
            if not safe_files:
                return {"error": "Aucun fichier valide sélectionné"}
            # The selection comes from the status shown when the panel was
            # opened: a file that has since lost its changes or vanished (a new
            # file deleted meanwhile, by a Claude session for instance) matches
            # nothing and git rejects the whole commit. Keep what still changed.
            current = self._changed_paths(path)
            if current is not None:
                skipped = [f for f in safe_files if f not in current]
                safe_files = [f for f in safe_files if f in current]
                if not safe_files:
                    return {"error": "Les fichiers sélectionnés n'ont plus de changements à committer"}
            # Plain `git add -- <path>` only picks up new/modified content in
            # the working tree — a path that's been deleted matches nothing
            # there, so it fails with "pathspec did not match any files" even
            # though the deletion is exactly what the user checked off to
            # commit. -A also considers removals for the given pathspec.
            out, err, code = run_git(path, "add", "-A", "--", *safe_files)
        else:
            out, err, code = run_git(path, "add", "-A")
        if code != 0:
            return {"error": err}
        out, err, code = run_git(path, "commit", "-m", message)
        if code != 0:
            return {"error": err or out}
        result = {"ok": True}
        if files and current is not None and skipped:
            result["skipped"] = skipped
        return result

    def _changed_paths(self, path):
        """Paths git currently reports as changed (a rename by its new path),
        or None if the status can't be read."""
        out, _err, code = run_git(path, "status", "--porcelain=v2", "-z")
        if code != 0:
            return None
        paths = set()
        entries = out.split("\0")
        i = 0
        while i < len(entries):
            e = entries[i]
            if e.startswith("? ") or e.startswith("! "):
                paths.add(e[2:])
            elif e.startswith("1 "):
                paths.add(e.split(" ", 8)[8])
            elif e.startswith("u "):
                paths.add(e.split(" ", 10)[10])
            elif e.startswith("2 "):
                paths.add(e.split(" ", 9)[9])
                # Skip the rename's original path: it is already gone from the
                # index and the working tree, `git add` would reject it too.
                i += 1
            i += 1
        return paths

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
        from app_config import APP_DATA_DIR

        try:
            reply = call_cli(cli_command, "Reply with exactly: OK", str(APP_DATA_DIR))
        except Exception as e:
            return {"ok": False, "error": str(e)}
        return {"ok": True, "reply": reply[:200]}

    def generate_commit_message(self, path, language=None, files=None):
        ai = load_config().get("ai", {})
        provider = ai.get("provider")
        is_cli = provider in ("claude-code", "codex", "cli")
        if not is_cli and not ai.get("api_key"):
            return {"error": "Aucune clé API configurée (voir Paramètres IA)"}

        diff_result = self.get_diff(path, files)
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
                message = call_cli(ai.get("cli_command"), prompt, path)
            elif provider == "anthropic":
                message = call_anthropic(ai, prompt)
            else:
                message = call_openai_compatible(ai, prompt)
        except Exception as e:
            return {"error": str(e)}

        return {"message": message.strip().strip('"')}

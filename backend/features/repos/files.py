import base64
import mimetypes
import os
from pathlib import Path

from app_config import load_config
from features.git.run_git import run_git, safe_repo_file

# Directories the Code tab's file tree never descends into — not a
# .gitignore mirror (that would also hide .env and other files people
# actually want to browse), just the handful of folders that are always
# noise and can blow up to tens of thousands of entries.
CODE_BROWSER_SKIP_DIRS = {
    # Kept intentionally short — "build"/"dist"/"out" etc. used to be on
    # this list too, but people legitimately want to browse build output;
    # only VCS internals and dependency caches that are both never useful
    # to browse AND can genuinely reach tens of thousands of files stay
    # excluded.
    ".git", "node_modules", "__pycache__", ".venv", "venv",
}


class ReposFilesMixin:
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

    def list_repo_files(self, path):
        # A real filesystem walk, not `git ls-files` — the git-based version
        # hid anything gitignored (.env, generated docs, etc.), which meant
        # the browser was missing files that are very much still "part of
        # the project". Only a short, universally-noise list of directories
        # is skipped, purely so a stray node_modules doesn't turn the tree
        # into tens of thousands of rows.
        base = Path(path)
        files = []
        for root, dirs, filenames in os.walk(base):
            dirs[:] = [d for d in dirs if d not in CODE_BROWSER_SKIP_DIRS]
            rel_root = Path(root).relative_to(base)
            for name in filenames:
                rel = name if str(rel_root) == "." else f"{rel_root.as_posix()}/{name}"
                files.append(rel)
        return {"files": files}

    def read_file_content(self, path, file):
        if not safe_repo_file(path, file):
            return {"error": "Chemin de fichier invalide"}
        file_path = Path(path) / file
        if not file_path.is_file():
            return {"error": "Fichier introuvable"}
        try:
            size = file_path.stat().st_size
        except OSError as e:
            return {"error": str(e)}

        # .ts/.mts/.cts is TypeScript here, but the system MIME database
        # (what mimetypes.guess_type reads) registers .ts as the much
        # older MPEG-2 Transport Stream video format — guessing it as
        # video/mp2t sent every .ts file down the base64 "video" path,
        # which produced a blank/broken player instead of the source.
        mime = None if file_path.suffix.lower() in (".ts", ".mts", ".cts") else mimetypes.guess_type(file_path.name)[0]
        is_renderable_binary = mime and (
            mime.startswith("image/") or mime.startswith("video/") or mime.startswith("audio/") or mime == "application/pdf"
        )
        if is_renderable_binary:
            # Base64-inlined through the JSON bridge, not streamed — fine
            # for images/PDFs and short clips, but a full movie file would
            # both bloat memory and be slow to hand over this way, so the
            # cap is generous for media without trying to support arbitrary
            # video sizes.
            if size > 20 * 1024 * 1024:
                return {"error": "Fichier trop volumineux pour l'aperçu (> 20 Mo) — ouvre-le dans l'IDE.", "tooLarge": True}
            try:
                data = file_path.read_bytes()
            except OSError as e:
                return {"error": str(e)}
            encoded = base64.b64encode(data).decode("ascii")
            return {"dataUrl": f"data:{mime};base64,{encoded}", "mime": mime, "size": size}

        if size > 2 * 1024 * 1024:
            return {"error": "Fichier trop volumineux pour l'aperçu (> 2 Mo) — ouvre-le dans l'IDE.", "tooLarge": True}
        try:
            data = file_path.read_bytes()
        except OSError as e:
            return {"error": str(e)}
        if b"\x00" in data[:8000]:
            return {"binary": True, "size": size}
        return {"content": data.decode("utf-8", errors="replace"), "size": size}

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
        if not safe_repo_file(path, pattern):
            return {"error": "Chemin de fichier invalide"}
        out, err, code = run_git(path, "ls-files", "--", pattern)
        if code != 0:
            return {"error": err or "git ls-files a échoué"}
        files = [f for f in out.splitlines() if f]
        return {"count": len(files), "sample": files[:5]}

    def add_to_ignore(self, path, filename, pattern, untrack=False):
        if not safe_repo_file(path, pattern):
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

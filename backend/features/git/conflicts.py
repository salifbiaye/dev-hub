import shutil
from pathlib import Path

from .run_git import run_git, safe_repo_file


def has_conflict_markers(path, file):
    # Marking a file "resolved" just stages whatever's currently on disk —
    # without this check, clicking it before actually editing the file
    # would silently commit the literal <<<<<<< / ======= / >>>>>>> lines
    # git left behind.
    file_path = Path(path) / file
    if not file_path.exists():
        return False
    try:
        text = file_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    lines = text.splitlines()
    return any(l.startswith("<<<<<<< ") for l in lines) and any(l.startswith(">>>>>>> ") for l in lines)


class GitConflictsMixin:
    def abort_merge(self, path):
        out, err, code = run_git(path, "merge", "--abort")
        if code != 0:
            return {"error": err or out}
        return {"ok": True}

    def mark_resolved(self, path, file):
        if not safe_repo_file(path, file):
            return {"error": "Chemin de fichier invalide"}
        if has_conflict_markers(path, file):
            return {"error": f"{file} contient encore des marqueurs de conflit (<<<<<<<) — résous-le avant de le marquer résolu."}
        out, err, code = run_git(path, "add", "--", file)
        if code != 0:
            return {"error": err or out}
        return {"ok": True}

    def get_conflict_versions(self, path, file):
        if not safe_repo_file(path, file):
            return {"error": "Chemin de fichier invalide"}

        def show(stage):
            out, err, code = run_git(path, "show", f":{stage}:{file}")
            return out if code == 0 else None

        def diff_vs_base(stage):
            # Stage 1 of a conflicted index entry is the common ancestor —
            # diffing each side against it (instead of ours vs theirs raw)
            # shows exactly what THAT side changed, colored, instead of two
            # walls of plain text with no visual indication of what differs.
            # Missing on add/add conflicts (no shared history): skip the diff,
            # the raw content is still shown as a fallback.
            out, err, code = run_git(path, "diff", "--no-color", f":1:{file}", f":{stage}:{file}")
            return out if code == 0 else None

        file_path = Path(path) / file
        current = ""
        if file_path.exists():
            current = file_path.read_text(encoding="utf-8", errors="replace")

        return {
            "ours": show(2),
            "theirs": show(3),
            "current": current,
            "ours_diff": diff_vs_base(2),
            "theirs_diff": diff_vs_base(3),
        }

    def save_conflict_resolution(self, path, file, content):
        if not safe_repo_file(path, file):
            return {"error": "Chemin de fichier invalide"}
        lines = content.splitlines()
        if any(l.startswith("<<<<<<< ") for l in lines) and any(l.startswith(">>>>>>> ") for l in lines):
            return {"error": "Le résultat contient encore des marqueurs de conflit (<<<<<<<) — retire-les avant d'enregistrer."}
        file_path = Path(path) / file
        file_path.write_text(content, encoding="utf-8")
        out, err, code = run_git(path, "add", "--", file)
        if code != 0:
            return {"error": err or out}
        return {"ok": True}

    def discard_file_changes(self, path, file):
        # Rollback for a single file — a new/untracked file has no HEAD
        # version to restore, so it's just deleted; a tracked file (staged
        # or not) is reset back to what's actually committed.
        if not safe_repo_file(path, file):
            return {"error": "Chemin de fichier invalide"}
        out, err, code = run_git(path, "status", "--porcelain=v1", "--", file)
        if code != 0:
            return {"error": err}
        is_untracked = out[:2].strip() == "??"
        if is_untracked:
            file_path = Path(path) / file
            try:
                if file_path.is_dir():
                    shutil.rmtree(file_path)
                elif file_path.exists():
                    file_path.unlink()
            except OSError as e:
                return {"error": str(e)}
            return {"ok": True}
        run_git(path, "reset", "--", file)
        out, err, code = run_git(path, "checkout", "--", file)
        if code != 0:
            return {"error": err or out}
        return {"ok": True}

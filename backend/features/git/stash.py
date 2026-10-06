import re

from .run_git import run_git, safe_repo_file


class GitStashMixin:
    def list_stashes(self, path):
        # Stashes are just commits, so `git log`-style format placeholders
        # work here too. %gs is the reflog subject — "On <branch>: <msg>"
        # for a custom message, "WIP on <branch>: <hash> <subject>" for the
        # default auto-generated one — parsed below to split branch/message.
        out, err, code = run_git(path, "stash", "list", "--format=%gd\x1f%gs\x1f%cr")
        if code != 0:
            return {"error": err}
        stashes = []
        for line in out.splitlines():
            if not line:
                continue
            parts = line.split("\x1f")
            if len(parts) != 3:
                continue
            ref, subject, rel_date = parts
            m = re.match(r"^(?:WIP on|On) ([^:]+): (.*)$", subject)
            stashes.append({
                "ref": ref,
                "branch": m.group(1) if m else None,
                "message": m.group(2) if m else subject,
                "date": rel_date,
            })
        return {"stashes": stashes}

    def stash_push(self, path, message=None, files=None):
        args = ["stash", "push"]
        if message:
            args += ["-m", message]
        if files:
            safe_files = [f for f in files if safe_repo_file(path, f)]
            if not safe_files:
                return {"error": "Aucun fichier valide sélectionné"}
            # Naming untracked files explicitly here stashes them too,
            # without needing the separate -u/--include-untracked flag.
            args += ["--", *safe_files]
        out, err, code = run_git(path, *args)
        if code != 0:
            return {"error": err or out}
        return {"ok": True}

    def _stash_conflict_result(self, path, out, err):
        status = self.git_status(path)
        conflicted = status.get("conflicted", [])
        message = "\n".join(filter(None, [out, err]))
        if conflicted:
            return {
                "error": f"Conflit sur {len(conflicted)} fichier(s) en réappliquant le stash : {', '.join(conflicted)}",
                "conflicted": conflicted,
            }
        return {"error": message}

    def stash_pop(self, path, ref):
        out, err, code = run_git(path, "stash", "pop", ref)
        if code != 0:
            return self._stash_conflict_result(path, out, err)
        return {"ok": True}

    def stash_apply(self, path, ref):
        out, err, code = run_git(path, "stash", "apply", ref)
        if code != 0:
            return self._stash_conflict_result(path, out, err)
        return {"ok": True}

    def stash_drop(self, path, ref):
        out, err, code = run_git(path, "stash", "drop", ref)
        if code != 0:
            return {"error": err or out}
        return {"ok": True}

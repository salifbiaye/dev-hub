from .run_git import run_git


class GitBranchesMixin:
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

    def branches(self, path, fetch=False):
        # Fetching hits the network and can take seconds, so it's opt-in
        # (the "Rafraîchir" button) rather than run on every tab load —
        # otherwise just switching tabs and back felt like it hung.
        if fetch:
            run_git(path, "fetch", "--quiet")

        out, err, code = run_git(path, "branch", "--all", "--format=%(refname:short)")
        if code != 0:
            return {"error": err}
        names = [b for b in out.splitlines() if b]

        # origin/main is the real shared source of truth — prefer it over
        # the local main, which can lag behind if this branch hasn't been
        # checked out and pulled in a while.
        base = None
        for candidate in ("origin/main", "origin/master", "main", "master"):
            if candidate in names:
                base = candidate
                break

        branches = []
        for name in names:
            entry = {"name": name}
            if base and name != base:
                out2, _, code2 = run_git(path, "rev-list", "--left-right", "--count", f"{base}...{name}")
                parts = out2.split() if code2 == 0 else []
                if len(parts) == 2:
                    entry["behind_base"] = int(parts[0])
                    entry["ahead_base"] = int(parts[1])
            # Same ahead/behind count vs main doesn't mean same commits —
            # two branches can each be "+3" with entirely different work.
            # The tip commit's hash + subject makes that visible at a glance.
            out3, _, code3 = run_git(path, "log", "-1", "--format=%h\x1f%s", name)
            if code3 == 0 and out3:
                sha, _, subject = out3.partition("\x1f")
                entry["last_commit"] = {"sha": sha, "subject": subject}
            branches.append(entry)

        return {"branches": branches, "base": base}

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

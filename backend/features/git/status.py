import re

from .run_git import run_git, safe_repo_file


class GitStatusMixin:
    def git_status(self, path):
        out, err, code = run_git(path, "status", "--porcelain=v2", "--branch")
        if code != 0:
            return {"error": err or "git status a échoué"}

        branch = None
        ahead = 0
        behind = 0
        dirty = 0
        untracked = 0
        conflicted = []
        files = []

        for line in out.splitlines():
            if line.startswith("# branch.head"):
                branch = line.split(" ")[-1]
            elif line.startswith("# branch.ab"):
                parts = line.split(" ")
                ahead = int(parts[-2].replace("+", ""))
                behind = int(parts[-1].replace("-", ""))
            elif line.startswith("?"):
                untracked += 1
                files.append({"path": line[2:], "status": "?"})
            elif line.startswith("u "):
                parts = line.split(" ", 10)
                p = parts[10]
                conflicted.append(p)
                files.append({"path": p, "status": "U"})
            elif line.startswith("1 "):
                dirty += 1
                parts = line.split(" ", 8)
                files.append({"path": parts[8], "status": parts[1]})
            elif line.startswith("2 "):
                dirty += 1
                parts = line.split(" ", 9)
                files.append({"path": parts[9].split("\t")[0], "status": parts[1]})

        return {
            "branch": branch,
            "ahead": ahead,
            "behind": behind,
            "dirty": dirty,
            "untracked": untracked,
            "conflicted": conflicted,
            "clean": dirty == 0 and untracked == 0 and not conflicted,
            "files": files,
        }

    def get_diff(self, path, files=None, full=False):
        # Scoping to a file selection keeps the AI-generated message (and
        # this diff) describing only what's actually about to be committed,
        # instead of every unrelated change sitting in the working tree.
        # `full` swaps git's default 3-line hunk context for effectively the
        # whole file in one hunk — used by the Code tab's file viewer to
        # show a complete file with its uncommitted changes highlighted,
        # rather than a compact patch. The AI-summary cap (20000 chars)
        # doesn't apply there — it's sized for read_file_content's own
        # 2 MB cap instead.
        safe_files = [f for f in files if safe_repo_file(path, f)] if files else None
        scope = ["--", *safe_files] if safe_files else []
        unified = ["--unified=100000"] if full else []
        cap = 2 * 1024 * 1024 if full else 20000

        out, err, code = run_git(path, "diff", "HEAD", *unified, *scope)
        if code != 0:
            return {"error": err or "git diff a échoué"}
        if out.strip():
            return {"diff": out[:cap]}

        # `git diff HEAD` never covers untracked files, so a repo that's
        # entirely new files (first commit, or a freshly scanned repo) comes
        # back empty even though there's plenty to describe. Only pay the
        # stage/unstage round-trip in that specific case — staging
        # everything on every call was the fix, but it made generation
        # noticeably slower even for the common "some tracked files
        # modified" case, which the plain diff above already handles fine.
        if safe_files:
            run_git(path, "add", "-A", "--", *safe_files)
        else:
            run_git(path, "add", "-A")
        out, err, code = run_git(path, "diff", "--cached", *unified, *scope)
        run_git(path, "reset", *scope)
        if code != 0:
            return {"error": err or "git diff a échoué"}
        return {"diff": out[:cap]}

    def git_log(self, path, limit=50):
        # \x1f (unit separator) can't appear in a commit subject, unlike a
        # plain delimiter like "|" or ":" which real commit messages do use.
        out, err, code = run_git(
            path, "log", f"-{int(limit)}", "--date=iso-strict", "--format=%H\x1f%h\x1f%an\x1f%ad\x1f%s"
        )
        if code != 0:
            return {"error": err or "git log a échoué"}
        commits = []
        for line in out.splitlines():
            parts = line.split("\x1f")
            if len(parts) == 5:
                commits.append({"hash": parts[0], "short": parts[1], "author": parts[2], "date": parts[3], "subject": parts[4]})
        return {"commits": commits}

    def list_contributors(self, path, ref="HEAD"):
        # Local `git shortlog`, not a GitHub/GitLab API call — no token or
        # per-host auth to manage, works offline, and already sorted by
        # commit count. It shows who has *committed* here, not who has push
        # access (that's a real "collaborators" concept the git CLI has no
        # notion of), but it's the useful-without-extra-setup version.
        # Scoped to a single ref rather than --all: someone can have
        # commits on one branch and none on another, so an all-branches
        # combined count would hide that per-branch difference.
        out, err, code = run_git(path, "shortlog", "-sne", ref or "HEAD")
        if code != 0:
            return {"error": err}
        contributors = []
        for line in out.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t", 1)
            if len(parts) != 2:
                continue
            count_str, rest = parts
            m = re.match(r"^(.*?)\s*<(.*?)>$", rest)
            contributors.append({
                "name": m.group(1) if m else rest,
                "email": m.group(2) if m else "",
                "commits": int(count_str.strip()),
            })
        return {"contributors": contributors}

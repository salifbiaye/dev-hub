"""The project's "Aperçu" tab: a GitHub-profile-like summary — commits per day for the
activity heatmap, stats, languages, contributors and the latest commits."""

import os
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from .run_git import run_git

# Extensions counted as "code" for the language bar (bytes per language, like GitHub).
LANGUAGES = {
    ".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin",
    ".go": "Go", ".rs": "Rust", ".php": "PHP", ".rb": "Ruby", ".cs": "C#", ".c": "C", ".h": "C",
    ".cpp": "C++", ".hpp": "C++", ".swift": "Swift", ".dart": "Dart", ".vue": "Vue", ".svelte": "Svelte",
    ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".sql": "SQL", ".sh": "Shell", ".ps1": "PowerShell",
}
MAX_FILES = 20000


def _monday_on_or_before(d):
    return d - timedelta(days=d.weekday())


def _languages(path):
    out, _, code = run_git(path, "ls-files")
    if code != 0 or not out:
        return []
    base = Path(path)
    sizes = Counter()
    for i, rel in enumerate(out.split("\n")):
        if i >= MAX_FILES:
            break
        lang = LANGUAGES.get(os.path.splitext(rel)[1].lower())
        if not lang:
            continue
        try:
            sizes[lang] += (base / rel).stat().st_size
        except OSError:
            continue
    total = sum(sizes.values())
    if not total:
        return []
    return [{"name": n, "percent": round(100 * b / total, 1)} for n, b in sizes.most_common(6)]


class GitOverviewMixin:
    def repo_overview(self, path, year=None, mine=False):
        if not Path(path).is_dir():
            return {"error": "Dossier introuvable"}
        today = date.today()
        year = int(year) if year else None
        if year:
            first, last = date(year, 1, 1), date(year, 12, 31)
        else:
            last = today
            first = today - timedelta(days=364)
        start = _monday_on_or_before(first)

        email, _, _ = run_git(path, "config", "user.email")
        log_args = ["log", "--all", "--no-merges", f"--since={start.isoformat()} 00:00", f"--until={last.isoformat()} 23:59:59", "--format=%ad", "--date=short"]
        if mine and email:
            log_args.append(f"--author={email}")
        out, err, code = run_git(path, *log_args)
        if code != 0:
            return {"error": err or "Pas un dépôt git"}
        counts = Counter(l for l in out.split("\n") if l)
        days = {d: n for d, n in counts.items() if first.isoformat() <= d <= last.isoformat()}

        years_out, _, _ = run_git(path, "log", "--all", "--format=%ad", "--date=format:%Y")
        years = sorted({int(y) for y in years_out.split("\n") if y.strip().isdigit()}, reverse=True)

        total, _, _ = run_git(path, "rev-list", "--count", "HEAD")
        contributors_out, _, _ = run_git(path, "shortlog", "-sn", "HEAD")
        contributors = []
        for line in contributors_out.split("\n")[:6]:
            parts = line.strip().split("\t", 1)
            if len(parts) == 2 and parts[0].isdigit():
                contributors.append({"name": parts[1], "commits": int(parts[0])})
        branches_out, _, _ = run_git(path, "branch", "--list")
        last_out, _, _ = run_git(path, "log", "-1", "--format=%ar")
        recent_out, _, _ = run_git(path, "log", "-n", "10", "--no-merges", "--format=%h%x1f%an%x1f%ar%x1f%s")
        recent = []
        for line in recent_out.split("\n"):
            parts = line.split("\x1f")
            if len(parts) == 4:
                recent.append({"hash": parts[0], "author": parts[1], "when": parts[2], "message": parts[3]})

        return {
            "start": start.isoformat(),
            "end": last.isoformat(),
            "days": days,
            "total": sum(days.values()),
            "year": year,
            "years": years,
            "mine": bool(mine and email),
            "commits": int(total) if total.isdigit() else 0,
            "contributors": contributors,
            "branches": len([b for b in branches_out.split("\n") if b.strip()]),
            "last_commit": last_out,
            "recent": recent,
            "languages": _languages(path),
        }


def _parse_log(out):
    commits = []
    for line in out.split("\n"):
        parts = line.split("\x1f")
        if len(parts) == 5:
            commits.append({"hash": parts[0], "short": parts[1], "author": parts[2], "date": parts[3], "subject": parts[4]})
    return commits


class GitHistoryMixin:
    def repo_history(self, path, page=1, per_page=20, search="", author="", year=None, month=None):
        """One page of the current branch's history, with filters (text, author, year, month).
        Filtering is done here, on the whole log, so pages and totals stay consistent."""
        if not Path(path).is_dir():
            return {"error": "Dossier introuvable"}
        out, err, code = run_git(path, "log", "HEAD", "-n", "20000", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s")
        if code != 0:
            return {"error": err or "Pas un dépôt git"}
        everything = _parse_log(out)

        by_author = Counter(c["author"] for c in everything)
        authors = [a for a, _ in by_author.most_common()]
        years = sorted({int(c["date"][:4]) for c in everything if c["date"][:4].isdigit()}, reverse=True)

        q = (search or "").strip().lower()
        year = int(year) if year else None
        month = int(month) if month else None

        def keep(c):
            if author and c["author"] != author:
                return False
            if year and not c["date"].startswith(f"{year:04d}-"):
                return False
            if month and c["date"][5:7] != f"{month:02d}":
                return False
            if q and q not in c["subject"].lower() and q not in c["author"].lower() and not c["hash"].startswith(q):
                return False
            return True

        shown = [c for c in everything if keep(c)]
        per_page = max(5, min(int(per_page or 20), 100))
        pages = max(1, -(-len(shown) // per_page))
        page = max(1, min(int(page or 1), pages))
        return {
            "commits": shown[(page - 1) * per_page : page * per_page],
            "total": len(shown),
            "all": len(everything),
            "page": page,
            "pages": pages,
            "per_page": per_page,
            "authors": authors,
            "years": years,
        }


class GitActivityMixin:
    def repo_activity(self, path, days=90):
        """Commits per day and per author on the current branch, for the evolution chart.
        days=0 means the whole history."""
        if not Path(path).is_dir():
            return {"error": "Dossier introuvable"}
        args = ["log", "HEAD", "--no-merges", "-n", "50000", "--format=%an%x1f%as"]
        days = int(days or 0)
        if days > 0:
            args.insert(2, f"--since={(date.today() - timedelta(days=days)).isoformat()} 00:00")
        out, err, code = run_git(path, *args)
        if code != 0:
            return {"error": err or "Pas un dépôt git"}
        series = {}
        for line in out.split("\n"):
            parts = line.split("\x1f")
            if len(parts) == 2 and parts[1]:
                series.setdefault(parts[0], Counter())[parts[1]] += 1
        authors = sorted(series, key=lambda a: -sum(series[a].values()))
        all_days = [d for a in authors for d in series[a]]
        return {
            "authors": authors,
            "series": {a: dict(series[a]) for a in authors},
            "first": min(all_days) if all_days else None,
            "today": date.today().isoformat(),
            "total": sum(sum(series[a].values()) for a in authors),
        }

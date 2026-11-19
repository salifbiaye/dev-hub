"""The "Sorties" tab: what the project's builds produced (jars, zips, installers, APKs, a
`dist/` folder…), found without being told where to look."""

import os
import subprocess
import sys
import time
from pathlib import Path

# Files that are a deliverable by themselves.
ARCHIVES = {".zip", ".tar", ".tgz", ".gz", ".7z", ".whl", ".nupkg", ".vsix"}
APPS = {".jar", ".war", ".ear", ".exe", ".msi", ".apk", ".aab", ".ipa", ".dmg", ".deb", ".rpm", ".appimage"}
ARTIFACT_EXT = ARCHIVES | APPS

# Folders builds write into (looked for at the root and one level down, for multi-module projects).
OUTPUT_DIRS = ("target", "build", "dist", "out", "bin", "release", "publish", "artifacts", "output", ".output", ".next", "storybook-static")
# A folder of these is itself the result (a web build), listed as one entry.
BUNDLE_DIRS = {"dist", "out", ".output", ".next", "storybook-static", "build", "publish", "output"}
# Inside an output folder: things that are intermediate, not the product.
SKIP_INSIDE = {"node_modules", "classes", "test-classes", "generated-sources", "generated-test-sources", "maven-status", "maven-archiver", "tmp", ".gradle", "surefire-reports", "jacoco", "reports", "resources", "kotlin", "intermediates", "cache", ".cache"}
SKIP_TOP = {".git", "node_modules", ".venv", "venv", "__pycache__", ".idea", ".vscode", "vendor"}

# Archives a build tool leaves for its own use (PyInstaller's runtime library…).
NOT_PRODUCTS = {"base_library.zip"}

MAX_ENTRIES = 150
MAX_WALK = 30000


def _kind(ext):
    return "archive" if ext in ARCHIVES else "app" if ext in APPS else "folder"


def _artifacts_in(root, base, depth=4):
    """Artifact files below `root` (depth-limited, skipping intermediates)."""
    out = []
    root_depth = len(Path(root).parts)
    for cur, dirs, files in os.walk(root):
        if len(Path(cur).parts) - root_depth >= depth:
            dirs[:] = []
        dirs[:] = [d for d in dirs if d not in SKIP_INSIDE and d not in SKIP_TOP]
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in ARTIFACT_EXT and f.lower() not in NOT_PRODUCTS:
                out.append(os.path.join(cur, f))
    return out


def _bundle(folder):
    """(file count, total size, newest mtime) of a build folder, bounded."""
    count = size = 0
    newest = 0.0
    for cur, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for f in files:
            try:
                st = os.stat(os.path.join(cur, f))
            except OSError:
                continue
            count += 1
            size += st.st_size
            newest = max(newest, st.st_mtime)
            if count >= MAX_WALK:
                return count, size, newest
    return count, size, newest


def _roots(base):
    found = []
    for name in OUTPUT_DIRS:
        d = base / name
        if d.is_dir():
            found.append(d)
    try:
        subs = [p for p in base.iterdir() if p.is_dir() and not p.name.startswith(".") and p.name not in SKIP_TOP and p.name not in OUTPUT_DIRS]
    except OSError:
        subs = []
    for sub in subs[:30]:
        for name in OUTPUT_DIRS:
            d = sub / name
            if d.is_dir():
                found.append(d)
    return found


def list_outputs(path, quick=False):
    base = Path(path)
    if not base.is_dir():
        return []
    seen, entries = set(), []

    def add_file(fp):
        key = os.path.normcase(fp)
        if key in seen:
            return
        seen.add(key)
        try:
            st = os.stat(fp)
        except OSError:
            return
        ext = os.path.splitext(fp)[1].lower()
        rel = Path(fp).relative_to(base).as_posix()
        entries.append({"kind": _kind(ext), "name": os.path.basename(fp), "rel": rel, "abs": os.path.normpath(fp), "ext": ext.lstrip("."), "size": st.st_size, "mtime": st.st_mtime, "count": None})

    # deliverables sitting at the root
    try:
        for f in base.iterdir():
            if f.is_file() and f.suffix.lower() in ARTIFACT_EXT:
                add_file(str(f))
    except OSError:
        pass

    for root in _roots(base):
        for fp in _artifacts_in(root, base):
            add_file(fp)
            if quick and entries:
                return entries
        if root.name in BUNDLE_DIRS and not (root.name == ".next" and not (root / "BUILD_ID").exists()):
            count, size, newest = _bundle(root)
            # Only worth a line when it is a real result: files, and not just the jars already listed.
            has_web = any((root / n).exists() for n in ("index.html", "assets", "static", "_next", "server", "public", "manifest.json", "asset-manifest.json"))
            # `.next` is also the dev server's cache: it is a result only after `next build` (BUILD_ID).
            if root.name == ".next" and not (root / "BUILD_ID").exists():
                has_web = False
            if count and has_web:
                rel = root.relative_to(base).as_posix()
                entries.append({"kind": "folder", "name": root.name, "rel": rel, "abs": os.path.normpath(str(root)), "ext": "", "size": size, "mtime": newest, "count": count})
                if quick:
                    return entries
    entries.sort(key=lambda e: e["mtime"], reverse=True)
    return entries[:MAX_ENTRIES]


def has_outputs(path):
    return bool(list_outputs(path, quick=True))


def reveal(path, rel):
    """Show the file in the system file manager (folders: open them)."""
    target = (Path(path) / rel).resolve()
    base = Path(path).resolve()
    if base not in target.parents and target != base:
        return {"error": "Chemin hors du projet"}
    if not target.exists():
        return {"error": "Introuvable (supprimé depuis ?)"}
    try:
        if sys.platform == "win32":
            if target.is_dir():
                os.startfile(str(target))  # noqa: S606 - opens the folder in Explorer
            else:
                subprocess.Popen(["explorer", f"/select,{target}"], creationflags=subprocess.CREATE_NO_WINDOW)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(target)] if target.is_file() else ["open", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target if target.is_dir() else target.parent)])
    except OSError as e:
        return {"error": str(e)}
    return {"ok": True}

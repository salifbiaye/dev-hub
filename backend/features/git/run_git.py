"""Shared helpers used by every features/git/*.py module (and imported by a
few other features that touch repo files: ide, repos)."""
import subprocess
from pathlib import Path


def run_git(path, *args):
    result = subprocess.run(
        ["git", "-C", path, *args],
        capture_output=True,
        text=True,
        # Without an explicit encoding, Python decodes with the Windows
        # console's locale codec (often cp1252) — a diff containing a byte
        # that codec can't map (accented text, a near-binary file, etc.)
        # crashes the internal reader thread, which leaves result.stdout as
        # None instead of raising here, so a plain .strip() below blew up
        # with "'NoneType' object has no attribute 'strip'" instead of a
        # clear decode error.
        encoding="utf-8",
        errors="replace",
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    return (result.stdout or "").strip(), (result.stderr or "").strip(), result.returncode


def safe_repo_file(path, file):
    if not file:
        return False
    repo_path = Path(path).resolve()
    target = (repo_path / file).resolve()
    return repo_path in target.parents

"""Shared helpers used by every features/git/*.py module (and imported by a
few other features that touch repo files: ide, repos)."""
import subprocess
from pathlib import Path


def run_git(path, *args):
    result = subprocess.run(
        ["git", "-C", path, *args],
        capture_output=True,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    return result.stdout.strip(), result.stderr.strip(), result.returncode


def safe_repo_file(path, file):
    if not file:
        return False
    repo_path = Path(path).resolve()
    target = (repo_path / file).resolve()
    return repo_path in target.parents

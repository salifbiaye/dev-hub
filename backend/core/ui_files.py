"""Where the UI files (frontend/dist) are served from, and PyInstaller leftovers.

The frozen DevHub.exe is one file: its bootloader unpacks everything into
%TEMP%\\_MEIxxxx, runs the app, and deletes that folder when it exits — except
files still locked by a running process. If the bootloader goes away while the
app keeps running (it happened to Hubi), every HTML/JS file vanishes and the
app's own pages answer 404 while the process lives on. So frozen builds copy
frontend/dist once per build into %LOCALAPPDATA%\\DevHub\\ui\\<key> and serve
it from there.

A force-killed process never gets that cleanup, so _MEI folders pile up
(hundreds, ~50 MB each). clean_stale_unpack_dirs() removes Dev Hub's own ones
that no running process uses.
"""
import hashlib
import os
import shutil
import sys
import tempfile
from pathlib import Path

from app_config import APP_DATA_DIR, APP_VERSION

_cache = {}


def _bundled_dist():
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "frontend" / "dist"
    return Path(__file__).resolve().parents[2] / "frontend" / "dist"


def _build_key(dist):
    # Version + a fingerprint of the files, so a rebuild with the same
    # version still gets its own copy.
    h = hashlib.sha1()
    for path in sorted(dist.rglob("*")):
        if path.is_file():
            st = path.stat()
            h.update(f"{path.relative_to(dist).as_posix()}:{st.st_size}".encode())
    return f"{APP_VERSION}-{h.hexdigest()[:10]}"


def ui_dist_dir():
    """frontend/dist to serve. From source: the build folder itself. Frozen:
    a stable copy outside the unpack folder (made once per build)."""
    if "dir" in _cache:
        return _cache["dir"]
    dist = _bundled_dist()
    if not getattr(sys, "frozen", False):
        _cache["dir"] = dist
        return dist
    root = APP_DATA_DIR / "ui"
    target = root / _build_key(dist)
    try:
        if not (target / "index.html").exists():
            root.mkdir(parents=True, exist_ok=True)
            staging = Path(tempfile.mkdtemp(prefix="staging-", dir=root))
            shutil.copytree(dist, staging / "dist")
            try:
                os.replace(staging / "dist", target)
            except OSError:
                pass  # the other process (Dev Hub / Hubi) made it first
            shutil.rmtree(staging, ignore_errors=True)
        # Older builds' copies.
        for old in root.iterdir():
            if old != target and not old.name.startswith("staging-"):
                shutil.rmtree(old, ignore_errors=True)
    except OSError:
        _cache["dir"] = dist  # fall back to the unpack folder
        return dist
    _cache["dir"] = target
    return target


def _is_devhub_unpack(folder):
    return (folder / "frontend").is_dir() and ((folder / "winpty").is_dir() or (folder / "webview").is_dir())


def _unpack_dirs_in_use():
    import psutil

    used = set()
    for proc in psutil.process_iter(["name"]):
        try:
            for m in proc.memory_maps():
                path = m.path
                i = path.find("\\_MEI")
                if i != -1:
                    used.add(os.path.normcase(path[: path.find("\\", i + 1)]))
        except (psutil.Error, OSError):
            continue
    return used


def clean_stale_unpack_dirs():
    """Delete Dev Hub's leftover %TEMP%\\_MEI* folders no process uses.
    Other PyInstaller apps' folders are recognized and left alone."""
    tmp = Path(tempfile.gettempdir())
    own = os.path.normcase(str(getattr(sys, "_MEIPASS", "")))
    candidates = [d for d in tmp.glob("_MEI*") if d.is_dir() and os.path.normcase(str(d)) != own and _is_devhub_unpack(d)]
    if not candidates:
        return {"removed": 0}
    used = _unpack_dirs_in_use()
    removed = 0
    for d in candidates:
        if os.path.normcase(str(d)) in used:
            continue
        shutil.rmtree(d, ignore_errors=True)
        if not d.exists():
            removed += 1
    return {"removed": removed}

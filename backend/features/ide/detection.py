import shutil
from pathlib import Path

from core.platform import platform_svc

KNOWN_IDES = ["webstorm", "idea1", "pycharm", "code", "rider", "goland", "clion", "phpstorm"]

IDE_PROCESS_NAMES = {
    "webstorm": "webstorm64.exe",
    "idea1": "idea64.exe",
    "idea": "idea64.exe",
    "pycharm": "pycharm64.exe",
    "rider": "rider64.exe",
    "goland": "goland64.exe",
    "clion": "clion64.exe",
    "phpstorm": "phpstorm64.exe",
    "code": "Code.exe",
}

# JetBrains keeps a per-IDE system directory holding the lock files it uses to
# hand a project off to an already-running instance.
IDE_SYSTEM_DIR_PREFIXES = {
    "webstorm": "WebStorm",
    "idea1": "IntelliJIdea",
    "idea": "IntelliJIdea",
    "pycharm": "PyCharm",
    "rider": "Rider",
    "goland": "GoLand",
    "clion": "CLion",
    "phpstorm": "PhpStorm",
}


def ide_ipc_is_broken(launcher):
    """True when the IDE is running but never created its .port socket.

    In that state its single-instance channel doesn't exist, so asking it to
    open another project can't work — JetBrains answers with
    DirectoryLock$CannotActivateException instead, which looks like a crash.
    """
    prefix = IDE_SYSTEM_DIR_PREFIXES.get(launcher)
    exe_name = IDE_PROCESS_NAMES.get(launcher)
    # A stale .pid is left behind by past sessions, so this only means
    # anything while the IDE is actually up.
    if not prefix or not exe_name or not platform_svc.is_process_running(exe_name):
        return False
    root = platform_svc.ide_dirs().get("jetbrains_root")
    if not root or not root.is_dir():
        return False
    candidates = sorted(
        (d for d in root.iterdir() if d.is_dir() and d.name.startswith(prefix)),
        key=lambda d: d.stat().st_mtime,
        reverse=True,
    )
    for d in candidates:
        # Only the instance that's actually running matters, and that's the
        # one holding a .pid file.
        if (d / ".pid").exists():
            return not (d / ".port").exists()
    return False


class IdeDetectionMixin:
    def list_ides(self):
        # Like Windows Explorer's "Open with" — only offer what actually
        # resolves to a launcher on this machine, not every known IDE name.
        return [ide for ide in KNOWN_IDES if shutil.which(ide)]

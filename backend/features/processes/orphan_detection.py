import os
import shutil
from pathlib import Path

from app_config import load_config
from core.platform import platform_svc
from features.terminal import sessions as terminal_sessions

from .run_configs import all_running


class ProcessesOrphanMixin:
    def find_orphan_processes(self):
        config = load_config()
        repo_paths = [r["path"] for r in config["repos"]]
        if not repo_paths:
            return []

        # Exclude the whole tree of every process Dev Hub is actively
        # tracking as running, not just its direct PID — otherwise its own
        # npm/node children get flagged as "orphans" even though the run is
        # perfectly alive.
        tracked_pids = set()
        for entry in all_running().values():
            proc = terminal_sessions.get(entry.get("terminal_id"))
            root = getattr(proc, "pid", None) if proc else None
            if root:
                tracked_pids.add(root)

        candidates = platform_svc.orphan_processes(repo_paths, tracked_pids)
        return [
            {
                "pid": info["pid"],
                "name": info["name"],
                "command": info["command"],
                "repo_path": info["repo_path"],
                "repo_name": Path(info["repo_path"]).name,
            }
            for info in candidates
        ]

    def kill_orphan(self, pid):
        result = platform_svc.kill_process_tree(pid)
        if not result.get("ok"):
            return {"error": result.get("error")}
        return {"ok": True}

    def kill_orphans(self, pids):
        for pid in pids:
            platform_svc.kill_process_tree(pid)
        return {"ok": True}

    def _stale_webview_temp_dirs(self):
        # Every launch, WebView2 makes pywebview create a fresh `tmp*`
        # profile dir under %TEMP% and never cleans the old ones up on its
        # own — they silently pile up (100 dirs / ~2.3GB observed here).
        # The current run's own dir is still open/locked, so it's naturally
        # skipped rather than needing to be excluded explicitly.
        tmp = Path(os.environ.get("TEMP") or os.environ.get("TMP") or "")
        if not tmp.is_dir():
            return []
        return [d for d in tmp.glob("tmp*") if (d / "EBWebView").is_dir()]

    def clean_stale_webview_temp(self):
        removed = 0
        failed = 0
        for d in self._stale_webview_temp_dirs():
            try:
                shutil.rmtree(d)
                removed += 1
            except Exception:
                failed += 1
        return {"removed": removed, "failed": failed}

import psutil

from features.terminal import sessions as terminal_sessions

from .run_configs import all_running

_psutil_procs = {}
_CPU_COUNT = psutil.cpu_count() or 1


class ProcessesStatsMixin:
    def get_process_stats(self):
        global _psutil_procs
        seen_pids = set()
        results = []

        for key, entry in all_running().items():
            proc = terminal_sessions.get(entry.get("terminal_id"))
            root_pid = getattr(proc, "pid", None) if proc else None
            if not root_pid:
                continue
            try:
                root = psutil.Process(root_pid)
                tree = [root] + root.children(recursive=True)
            except psutil.NoSuchProcess:
                continue

            cpu = 0.0
            mem = 0
            alive = 0
            for p in tree:
                cached = _psutil_procs.get(p.pid)
                if cached is None:
                    # First time seeing this pid: prime the delta tracker and
                    # skip its CPU contribution *this* round. Calling
                    # cpu_percent(None) twice back-to-back (prime, then
                    # immediately read for the total) measures against an
                    # ~0ms window, which is exactly what was spiking every
                    # fresh process to ~100% on its very first poll.
                    try:
                        p.cpu_percent(None)
                        mem += p.memory_info().rss
                        alive += 1
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        continue
                    _psutil_procs[p.pid] = p
                    seen_pids.add(p.pid)
                    continue
                seen_pids.add(p.pid)
                try:
                    # Raw psutil cpu_percent is "% of one core" (can exceed
                    # 100 on multi-core work) — dividing by the core count
                    # matches the intuitive Task Manager-style 0-100 reading.
                    cpu += cached.cpu_percent(None) / _CPU_COUNT
                    mem += cached.memory_info().rss
                    alive += 1
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue

            results.append(
                {
                    "path": entry["path"],
                    "config": entry["config"],
                    "cpu_percent": round(cpu, 1),
                    "memory_mb": round(mem / (1024 * 1024), 1),
                    "process_count": alive,
                }
            )

        # Drop cached Process objects for pids that no longer exist — otherwise
        # this dict grows forever across a long session of starting/stopping runs.
        _psutil_procs = {pid: p for pid, p in _psutil_procs.items() if pid in seen_pids}
        return results

import json
import subprocess


def kill_process_tree(pid):
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def terminate_by_name(exe_name, force=False):
    args = ["taskkill", "/F", "/IM", exe_name] if force else ["taskkill", "/IM", exe_name]
    try:
        subprocess.run(args, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        return True
    except Exception:
        return False


def orphan_processes(repo_paths, tracked_pids):
    if not repo_paths:
        return []

    try:
        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process | "
                "Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
            ],
            capture_output=True,
            text=True,
            timeout=15,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        processes = json.loads(result.stdout or "[]")
        if isinstance(processes, dict):
            processes = [processes]
    except Exception:
        return []

    children_by_parent = {}
    for p in processes:
        children_by_parent.setdefault(p.get("ParentProcessId"), []).append(p.get("ProcessId"))

    def descendants_of(root_pid):
        found = set()
        stack = [root_pid]
        while stack:
            current = stack.pop()
            for child_pid in children_by_parent.get(current, []):
                if child_pid not in found:
                    found.add(child_pid)
                    stack.append(child_pid)
        return found

    # Exclude the whole tree of every process Dev Hub is actively tracking as
    # running, not just its direct PID — otherwise its own npm/node children
    # get flagged as "orphans" even though the run is perfectly alive.
    expanded_tracked = set()
    for root in tracked_pids:
        if root:
            expanded_tracked.add(root)
            expanded_tracked |= descendants_of(root)

    candidates = {}
    for proc in processes:
        pid = proc.get("ProcessId")
        cmdline = proc.get("CommandLine") or ""
        name = (proc.get("Name") or "").lower()
        if not pid or pid in expanded_tracked or name not in ("node.exe", "cmd.exe"):
            continue
        for repo_path in repo_paths:
            if repo_path.lower() in cmdline.lower():
                candidates[pid] = {
                    "pid": pid,
                    "ppid": proc.get("ParentProcessId"),
                    "name": proc.get("Name"),
                    "command": cmdline,
                    "repo_path": repo_path,
                }
                break

    # One orphan tree (cmd -> npm -> node -> worker) matches at every level;
    # keep only each tree's root so it shows up once instead of duplicated.
    orphans = []
    for pid, info in candidates.items():
        if info["ppid"] in candidates:
            continue
        orphans.append(info)
    return orphans

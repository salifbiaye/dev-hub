import psutil

# Linux-appropriate process names for orphan_processes() below -- no ".exe"
# suffix, and the shells run-configs spawn here are "node"/"bash"/"sh"
# instead of Windows' "node.exe"/"cmd.exe".
_ORPHAN_PROCESS_NAMES = ("node", "bash", "sh")


def kill_process_tree(pid):
    try:
        parent = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    try:
        children = parent.children(recursive=True)
        for child in children:
            try:
                child.kill()
            except Exception:
                pass
        try:
            parent.kill()
        except Exception:
            pass
        gone, alive = psutil.wait_procs([parent, *children], timeout=5)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def terminate_by_name(exe_name, force=False):
    name = exe_name.lower()
    found = False
    try:
        for proc in psutil.process_iter(["name"]):
            if (proc.info.get("name") or "").lower() == name:
                found = True
                try:
                    if force:
                        proc.kill()
                    else:
                        proc.terminate()
                except Exception:
                    pass
        return found
    except Exception:
        return False


def orphan_processes(repo_paths, tracked_pids):
    if not repo_paths:
        return []

    try:
        processes = []
        for proc in psutil.process_iter(["pid", "ppid", "name"]):
            try:
                cmdline = " ".join(proc.cmdline())
            except Exception:
                cmdline = ""
            processes.append(
                {
                    "ProcessId": proc.info.get("pid"),
                    "ParentProcessId": proc.info.get("ppid"),
                    "Name": proc.info.get("name"),
                    "CommandLine": cmdline,
                }
            )
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
    # running, not just its direct PID -- otherwise its own npm/node children
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
        if not pid or pid in expanded_tracked or name not in _ORPHAN_PROCESS_NAMES:
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

    # One orphan tree (bash -> npm -> node -> worker) matches at every level;
    # keep only each tree's root so it shows up once instead of duplicated.
    orphans = []
    for pid, info in candidates.items():
        if info["ppid"] in candidates:
            continue
        orphans.append(info)
    return orphans

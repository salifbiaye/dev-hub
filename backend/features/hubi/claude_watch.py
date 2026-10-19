"""Claude Code sessions Hubi was not told about, from their transcripts.

The hooks (claude_hooks.py) only speak on events: a session already running
when Hubi starts is unknown until its next prompt, and a session started
before the hooks were installed never sends Stop. Every few seconds this reads
the tail of recently written transcripts (~/.claude/projects/*/<session>.jsonl)
and:
- adds a running session Hubi does not know yet (last message = the user's,
  or Claude mid-turn calling a tool);
- closes a session Hubi still shows as working once Claude's last reply ended
  its turn and the file went quiet (the Stop hook never came).
"Waiting for an answer" stays the hooks' business. Session keys are the
session ids, the same ones the hooks use, so both sources update one entry.
"""
import json
import threading
import time
from pathlib import Path

from . import reactions

ROOT = Path.home() / ".claude" / "projects"
EVERY = 5.0  # s between passes
AGENT_ACTIVE = 60.0  # s: a sub-agent that wrote within this window and has not ended its turn is working
RECENT = 120.0  # s: transcripts written within this window are looked at
QUIET = 20.0  # s without writes before an ended turn counts as finished
TAIL_BYTES = 96 * 1024

_stop = threading.Event()
_thread = None


def _last_turn_state(path, sidechain=False):
    """('working' | 'done' | None, cwd) from the end of a transcript."""
    try:
        with path.open("rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - TAIL_BYTES))
            lines = fh.read().decode("utf-8", errors="replace").splitlines()
    except OSError:
        return None, None
    cwd = None
    for line in reversed(lines):
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        cwd = cwd or obj.get("cwd")
        if obj.get("isSidechain") and not sidechain:
            continue  # a sub-agent's own turn, not the session's
        kind = obj.get("type")
        if kind == "user":
            return "working", cwd or obj.get("cwd")
        if kind == "assistant":
            stop = (obj.get("message") or {}).get("stop_reason")
            return ("done" if stop == "end_turn" else "working"), cwd or obj.get("cwd")
    return None, cwd


_start_cwds = {}


def _start_cwd(path):
    """The folder the session started in: Claude may cd into subfolders later,
    which would name the project after the subfolder."""
    if path in _start_cwds:
        return _start_cwds[path]
    cwd = None
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                if i >= 60:
                    break
                try:
                    cwd = json.loads(line).get("cwd")
                except ValueError:
                    continue
                if cwd:
                    break
    except OSError:
        pass
    _start_cwds[path] = cwd
    return cwd


def _enabled():
    """Same switch as the hooks: Claude is the agent and Hubi follows it."""
    from features.terminal.sessions import cli_kind

    from . import channel, claude_hooks

    try:
        return cli_kind() == "claude" and claude_hooks.is_enabled(channel.get_token())
    except Exception:
        return False


def _working_agents(now):
    """Sub-agents (Task tool) still at work: their own transcripts live in
    <project>/<session>/subagents/*.jsonl."""
    n = 0
    for path in ROOT.glob("*/*/subagents/*.jsonl"):
        try:
            if now - path.stat().st_mtime > AGENT_ACTIVE:
                continue
        except OSError:
            continue
        state, _cwd = _last_turn_state(path, sidechain=True)
        if state == "working":
            n += 1
    return n


def _pass():
    if not _enabled():
        reactions.set_agents("claude", 0)
        return
    now = time.time()
    reactions.set_agents("claude", _working_agents(now))
    known = reactions.session_states(tool="claude")
    for path in ROOT.glob("*/*.jsonl"):
        try:
            age = now - path.stat().st_mtime
        except OSError:
            continue
        sid = path.stem
        if age > RECENT and sid not in known:
            continue
        state, cwd = _last_turn_state(path)
        project = reactions.project_name(_start_cwd(path) or cwd)
        if state == "working" and sid not in known and age <= RECENT:
            reactions.handle_event("claude_working", project, None, sid)
        elif state == "done" and known.get(sid) == "working" and age >= QUIET:
            reactions.handle_event("claude_done", project, None, sid)


def _loop():
    while True:
        try:
            _pass()
        except Exception:
            pass
        if _stop.wait(EVERY):
            return


def start():
    global _thread
    if _thread is not None or not ROOT.exists():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, daemon=True)
    _thread.start()


def stop():
    global _thread
    _stop.set()
    _thread = None

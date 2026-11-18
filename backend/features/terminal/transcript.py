"""Reads the transcript a Claude Code / Codex session writes on disk, so the
IA tab can draw the conversation itself instead of showing the CLI's screen.

The UI polls `ai_transcript_poll` with the byte offset it already consumed; the
reply carries the new events (normalised, small) and the new offset.
"""

import json
import re
import time
from pathlib import Path

from .sessions import _claude_project_dir, _codex_meta, _norm, cli_binary, cli_kind, codex_state_db, open_codex_db

_MAX_READ = 3 * 1024 * 1024  # per poll: a huge session is streamed over several polls
_TEXT_CAP = 6000
_USER_CAP = 200000  # a message you wrote can be restored to edit: keep it whole
_INPUT_CAP = 3000
_TAGS = re.compile(r"<(system-reminder|ide_[a-z_]+|environment_context|user_instructions)>.*?</\1>", re.S)
_CMD_NAME = re.compile(r"<command-name>(.*?)</command-name>", re.S)
_CMD_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.S)
_LOCAL_OUT = re.compile(r"<local-command-(stdout|stderr)>(.*?)</local-command-\1>", re.S)


def _cap(text, limit=_TEXT_CAP):
    text = text if isinstance(text, str) else json.dumps(text, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + f"\n… (+{len(text) - limit} caractères)"


def _compact_input(value):
    """Tool input trimmed so one huge Write doesn't travel through the bridge."""
    if isinstance(value, dict):
        return {k: _compact_input(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_compact_input(v) for v in value[:50]]
    if isinstance(value, str):
        return _cap(value, _INPUT_CAP)
    return value


def _result_text(content):
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        if isinstance(block, dict):
            if block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif block.get("type") == "image":
                parts.append("[image]")
    return "\n".join(parts)


def _claude_events(obj):
    if obj.get("isSidechain") or obj.get("isMeta"):
        return []
    kind = obj.get("type")
    message = obj.get("message") or {}
    content = message.get("content")
    ts = obj.get("timestamp")
    uid = obj.get("uuid")
    out = []
    if kind == "user":
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        for i, block in enumerate(content or []):
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_result":
                out.append(
                    {
                        "id": f"{uid}:{i}",
                        "kind": "result",
                        "tool_id": block.get("tool_use_id"),
                        "text": _cap(_result_text(block.get("content"))),
                        "is_error": bool(block.get("is_error")),
                    }
                )
            elif block.get("type") == "text":
                raw = block.get("text", "")
                name = _CMD_NAME.search(raw)
                if name:
                    args = _CMD_ARGS.search(raw)
                    out.append({"id": f"{uid}:{i}", "kind": "command", "text": (name.group(1) + " " + (args.group(1) if args else "")).strip(), "ts": ts})
                    continue
                local = _LOCAL_OUT.search(raw)
                if local:
                    if local.group(2).strip():
                        out.append({"id": f"{uid}:{i}", "kind": "system", "text": _cap(local.group(2).strip())})
                    continue
                text = _TAGS.sub("", raw).strip()
                if not text:
                    continue
                if text.startswith("[Request interrupted"):
                    out.append({"id": f"{uid}:{i}", "kind": "system", "text": "Interrompu"})
                else:
                    out.append({"id": f"{uid}:{i}", "kind": "user", "text": _cap(text, _USER_CAP), "ts": ts})
            elif block.get("type") == "image":
                out.append({"id": f"{uid}:{i}", "kind": "user", "text": "[image jointe]", "ts": ts})
    elif kind == "assistant":
        for i, block in enumerate(content or []):
            if not isinstance(block, dict):
                continue
            bid = f"{uid}:{i}"
            if block.get("type") == "text" and block.get("text", "").strip():
                out.append({"id": bid, "kind": "assistant", "text": _cap(block["text"]), "ts": ts})
            elif block.get("type") == "thinking" and block.get("thinking", "").strip():
                out.append({"id": bid, "kind": "thinking", "text": _cap(block["thinking"])})
            elif block.get("type") == "tool_use":
                out.append(
                    {
                        "id": bid,
                        "kind": "tool",
                        "tool_id": block.get("id"),
                        "name": block.get("name"),
                        "input": _compact_input(block.get("input") or {}),
                    }
                )
    return out


def _codex_events(obj, n):
    if obj.get("type") != "response_item":
        return []
    p = obj.get("payload") or {}
    kind = p.get("type")
    ts = obj.get("timestamp")
    if kind == "message":
        role = p.get("role")
        text = "\n".join(
            b.get("text", "")
            for b in p.get("content") or []
            if isinstance(b, dict) and b.get("type") in ("input_text", "output_text")
        )
        text = _TAGS.sub("", text).strip()
        if not text or text.startswith("<"):
            return []
        if role == "user":
            return [{"id": f"c{n}", "kind": "user", "text": _cap(text, _USER_CAP), "ts": ts}]
        if role == "assistant":
            return [{"id": f"c{n}", "kind": "assistant", "text": _cap(text), "ts": ts}]
    elif kind == "reasoning":
        text = "\n".join(
            s.get("text", "") for s in (p.get("summary") or []) if isinstance(s, dict)
        ).strip()
        return [{"id": f"c{n}", "kind": "thinking", "text": _cap(text)}] if text else []
    elif kind in ("function_call", "custom_tool_call", "local_shell_call"):
        args = p.get("arguments") or p.get("input") or p.get("action") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError:
                args = {"input": args}
        name = p.get("name") or ("shell" if kind == "local_shell_call" else kind)
        return [
            {
                "id": f"c{n}",
                "kind": "tool",
                "tool_id": p.get("call_id") or p.get("id"),
                "name": name,
                "input": _compact_input(args if isinstance(args, dict) else {"input": args}),
            }
        ]
    elif kind in ("function_call_output", "custom_tool_call_output"):
        output = p.get("output")
        if isinstance(output, str):
            try:
                parsed = json.loads(output)
                if isinstance(parsed, dict) and "output" in parsed:
                    output = parsed["output"]
                elif isinstance(parsed, list):
                    output = "\n".join(b.get("text", "") for b in parsed if isinstance(b, dict))
            except ValueError:
                pass
        elif isinstance(output, list):
            output = "\n".join(b.get("text", "") for b in output if isinstance(b, dict))
        return [{"id": f"c{n}", "kind": "result", "tool_id": p.get("call_id"), "text": _cap(output or ""), "is_error": False}]
    return []


# ---- Codex: sessions whose rollout file is gone live in its history database
# (thread_history_<n>.sqlite, one row per conversation item).

def _codex_history_db():
    state = codex_state_db()
    if not state:
        return None
    digits = "".join(c for c in state.stem if c.isdigit())
    candidates = sorted(state.parent.glob("thread_history_*.sqlite"))
    # Same generation as state_<n> when there is one, else the newest.
    same = [c for c in candidates if "".join(ch for ch in c.stem if ch.isdigit()) == digits]
    pick = (same or candidates or [None])[-1]
    return open_codex_db(pick) if pick else None


def _codex_user_text(content):
    text = "\n".join(b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text").strip()
    marker = "## My request for Codex:"
    if marker in text:
        text = text.split(marker, 1)[1].strip()
    return text


def _diff_sides(diff):
    old, new = [], []
    for line in str(diff or "").split("\n"):
        if line.startswith("@@") or line.startswith("---") or line.startswith("+++"):
            continue
        if line.startswith("-"):
            old.append(line[1:])
        elif line.startswith("+"):
            new.append(line[1:])
    return "\n".join(old), "\n".join(new)


def _codex_item_events(item, ordinal):
    kind = item.get("type")
    iid = f"{item.get('id') or ordinal}:{ordinal}"
    if kind == "userMessage":
        text = _codex_user_text(item.get("content"))
        return [{"id": iid, "kind": "user", "text": _cap(text, _USER_CAP)}] if text else []
    if kind == "agentMessage":
        text = str(item.get("text") or "").strip()
        return [{"id": iid, "kind": "assistant", "text": _cap(text)}] if text else []
    if kind == "plan":
        text = str(item.get("text") or "").strip()
        return [{"id": iid, "kind": "assistant", "text": _cap(text)}] if text else []
    if kind == "reasoning":
        text = "\n".join(str(x if isinstance(x, str) else (x or {}).get("text", "")) for x in item.get("summary") or []).strip()
        return [{"id": iid, "kind": "thinking", "text": _cap(text)}] if text else []
    if kind == "commandExecution":
        actions = item.get("commandActions") or []
        command = (actions[0].get("command") if actions and isinstance(actions[0], dict) else None) or item.get("command") or ""
        code = item.get("exitCode")
        out = item.get("aggregatedOutput")
        text = out if out else ("" if code in (0, None) else f"Code de sortie {code}")
        return [
            {"id": iid, "kind": "tool", "tool_id": item.get("id"), "name": "shell", "input": {"command": _cap(command, _INPUT_CAP)}},
            {"id": iid + ":r", "kind": "result", "tool_id": item.get("id"), "text": _cap(text or "", 2000), "is_error": code not in (0, None)},
        ]
    if kind == "fileChange":
        out = []
        for i, ch in enumerate(item.get("changes") or []):
            old, new = _diff_sides(ch.get("diff"))
            path = ch.get("path") or ""
            tid = f"{item.get('id')}:{i}"
            out.append({"id": f"{iid}:{i}", "kind": "tool", "tool_id": tid, "name": "Edit",
                        "input": {"file_path": path, "old_string": _cap(old, _INPUT_CAP), "new_string": _cap(new, _INPUT_CAP)}})
            out.append({"id": f"{iid}:{i}:r", "kind": "result", "tool_id": tid, "text": "", "is_error": False})
        return out
    if kind == "mcpToolCall":
        res = item.get("result") or {}
        text = "\n".join(b.get("text", "") for b in (res.get("content") or []) if isinstance(b, dict) and b.get("type") == "text")
        failed = item.get("status") == "failed" or bool(item.get("error"))
        if failed and not text:
            err = item.get("error")
            text = err if isinstance(err, str) else json.dumps(err, ensure_ascii=False) if err else "Échec"
        return [
            {"id": iid, "kind": "tool", "tool_id": item.get("id"), "name": f"{item.get('server')}.{item.get('tool')}", "input": _compact_input(item.get("arguments") or {})},
            {"id": iid + ":r", "kind": "result", "tool_id": item.get("id"), "text": _cap(text, 2000), "is_error": failed},
        ]
    return []


def _poll_codex_history(thread_id, offset, file_key):
    """Events of a Codex thread from its history DB, after ordinal `offset`.
    Returns None when the database has nothing for this thread."""
    con = _codex_history_db()
    if con is None:
        return None
    key = f"db:{thread_id}"
    reset = bool(file_key and file_key != key)
    if reset or not file_key:
        offset = 0
    try:
        total = con.execute("select count(*) from thread_items where thread_id = ?", (thread_id,)).fetchone()[0]
        if not total:
            return None
        rows = con.execute(
            "select rollout_ordinal, item_json from thread_items where thread_id = ? and rollout_ordinal > ? order by rollout_ordinal limit 600",
            (thread_id, offset - 1 if offset else -1),
        ).fetchall()
        last = con.execute("select max(rollout_ordinal) from thread_items where thread_id = ?", (thread_id,)).fetchone()[0] or 0
    except Exception:
        return None
    finally:
        con.close()
    events, new_offset = [], offset
    for ordinal, raw in rows:
        try:
            item = json.loads(raw)
        except ValueError:
            new_offset = ordinal + 1
            continue
        # A command or tool call still running is read again once it is done.
        if item.get("status") == "inProgress":
            break
        events.extend(_codex_item_events(item, ordinal))
        new_offset = ordinal + 1
    return {
        "supported": True,
        "events": events,
        "links": [],
        "offset": new_offset,
        "more": new_offset <= last and len(rows) >= 600,
        "file_key": key,
        "session_id": thread_id,
        "reset": reset,
        "now": time.time(),
    }


def _find_claude_file(path, session_id, started_at, exclude):
    folder = _claude_project_dir(path)
    if not folder.is_dir():
        return None
    if session_id:
        f = folder / f"{session_id}.jsonl"
        # A resumed session can continue in a fresh file: follow it once the
        # original stops being written and a newer, unclaimed one appears.
        newer = _newest(folder.glob("*.jsonl"), started_at, exclude | {session_id})
        if newer and (not f.exists() or f.stat().st_mtime < started_at - 2):
            return newer
        return f if f.exists() else None
    return _newest(folder.glob("*.jsonl"), started_at, exclude)


def _find_codex_file(path, session_id, started_at, exclude):
    root = Path.home() / ".codex" / "sessions"
    if not root.is_dir():
        return None
    target = _norm(path)
    best = None
    for f in root.rglob("rollout-*.jsonl"):
        try:
            mtime = f.stat().st_mtime
        except OSError:
            continue
        cwd, sid, _ = _codex_meta(f)
        if not sid or not cwd or _norm(cwd) != target:
            continue
        if session_id:
            if sid == session_id:
                return f
            continue
        if sid in exclude or mtime < started_at - 2:
            continue
        if best is None or mtime > best[0]:
            best = (mtime, f)
    return best[1] if best else None


def _newest(files, started_at, exclude):
    best = None
    for f in files:
        try:
            mtime = f.stat().st_mtime
        except OSError:
            continue
        if f.stem in exclude or mtime < started_at - 2:
            continue
        if best is None or mtime > best[0]:
            best = (mtime, f)
    return best[1] if best else None


class TranscriptMixin:
    def ai_transcript_poll(self, path, provider=None, session_id=None, started_at=None, offset=0, exclude=None, file_key=None):
        """New events of a session since `offset`. `file_key` is the file the
        offset belongs to: when the session moves to another file the reply
        has reset=True and starts again from 0."""
        kind = cli_kind(cli_binary(provider))
        if kind not in ("claude", "codex"):
            return {"supported": False, "events": [], "offset": 0}
        started_at = float(started_at or 0)
        exclude = set(exclude or [])
        # A resumed Codex session: its history database is the complete record
        # (the rollout file may be pruned, or hold only what came after the resume).
        if kind == "codex" and session_id:
            polled = _poll_codex_history(session_id, int(offset or 0), file_key)
            if polled is not None:
                return polled
        try:
            f = (_find_claude_file if kind == "claude" else _find_codex_file)(path, session_id, started_at, exclude)
        except OSError:
            f = None
        if f is None:
            return {"supported": True, "events": [], "offset": 0, "file_key": None, "session_id": None}
        key = str(f)
        reset = bool(file_key and file_key != key)
        if reset or not file_key:
            offset = 0
        try:
            size = f.stat().st_size
            if offset > size:
                offset, reset = 0, True
            with f.open("rb") as fh:
                fh.seek(offset)
                chunk = fh.read(_MAX_READ)
                # One line can be bigger than a chunk (an inlined image): keep
                # reading until it ends, so the offset always moves forward.
                while b"\n" not in chunk and offset + len(chunk) < size and len(chunk) < 256 * 1024 * 1024:
                    more_bytes = fh.read(_MAX_READ)
                    if not more_bytes:
                        break
                    chunk += more_bytes
        except OSError:
            return {"supported": True, "events": [], "offset": offset, "file_key": key, "session_id": None}
        end = chunk.rfind(b"\n")
        if end < 0:
            return {"supported": True, "events": [], "offset": offset, "file_key": key, "session_id": _session_of(kind, f), "reset": reset}
        events = []
        links = []
        n = offset
        for line in chunk[: end + 1].split(b"\n"):
            n += len(line) + 1
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if kind == "claude":
                new = _claude_events(obj)
                uid = obj.get("uuid")
                # The file keeps every branch: after a rewind the abandoned
                # messages stay in it, and the new ones hang off an earlier
                # message. The UI follows parent links from the last line to
                # show only the live branch — so every line's links travel.
                if uid and not obj.get("isSidechain"):
                    # After /compact the boundary has no parent but names the
                    # message it continues (logicalParentUuid).
                    links.append([uid, obj.get("parentUuid") or obj.get("logicalParentUuid")])
                for e in new:
                    e["uuid"] = uid
                events.extend(new)
            else:
                events.extend(_codex_events(obj, n))
        return {
            "supported": True,
            "events": events,
            "links": links,
            "offset": offset + end + 1,
            "more": offset + end + 1 < size,
            "file_key": key,
            "session_id": _session_of(kind, f),
            "reset": reset,
            "now": time.time(),
        }


def _session_of(kind, f):
    if kind == "claude":
        return f.stem
    return _codex_meta(f)[1]

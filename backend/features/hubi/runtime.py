"""Hubi process services besides the eyes window: the control server, the
timer watcher, the tasks count and the quick-add hotkey."""
from . import codex_watch, quick_add, reactions, server, tasks, timer, tray, window


def tasks_changed():
    try:
        count = len(tasks.open_tasks())
    except Exception:
        return
    window.push_cmd("tasks", count)
    tray.refresh()


def _on_event(payload):
    kind = payload.get("kind")
    if kind == "task_noted":
        import threading

        threading.Thread(
            target=quick_add._play_noting, args=({"text": str(payload.get("message") or "")[:300]},), daemon=True
        ).start()
        return
    if kind == "sound_test":
        window.push_cmd("beep", "done")  # even with sounds off: it's a test
        window.send_mood("happy")
        return
    if kind in ("claude_working", "claude_waiting", "claude_done", "claude_error", "run_error", "run_done", "info"):
        reactions.handle_event(kind, payload.get("project"), payload.get("message"), None)


def _on_timer(payload):
    action = payload.get("action")
    if action == "start":
        if not timer.start(payload.get("seconds"), payload.get("label")):
            raise ValueError("durée invalide")
    elif action == "cancel":
        timer.cancel()
    tray.refresh()


ROUTES = {
    "/event": _on_event,
    "/claude": reactions.handle_claude_hook,
    "/timer": _on_timer,
    "/tasks/changed": lambda payload: tasks_changed(),
}


def start(base_url):
    server.start(ROUTES)
    timer.start_watcher()
    tasks_changed()
    quick_add.start(base_url, tasks_changed)
    codex_watch.start()


def stop():
    codex_watch.stop()
    quick_add.stop()
    server.stop()

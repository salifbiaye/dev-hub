"""Dev Hub's side of Hubi: lets the main UI read/toggle the widget."""
import webview

from app_config import load_config, save_config

from . import codex_watch, tray, window


def quit_all():
    """Tray "Quitter": close every window, which ends webview.start()."""
    for w in list(webview.windows):
        try:
            w.destroy()
        except Exception:
            pass


def start(base_url):
    """Hubi process: the widget window, its tray icon and its services."""
    from . import runtime

    window.configure(base_url)
    window.create()
    tray.start(on_quit=quit_all)
    runtime.start(base_url)


def stop():
    from . import runtime

    runtime.stop()
    tray.stop()
    window.destroy()


def _agent_state(claude_hooks):
    from features.terminal.sessions import CLI_LABELS, cli_kind

    kind = cli_kind()
    on = {"claude": claude_hooks, "codex": codex_watch.notify_flag()}.get(kind, False)
    return {"agent": kind, "agent_label": CLI_LABELS[kind] if kind != "other" else None, "agent_notify": bool(on)}


class HubiMixin:
    """Dev Hub's controls for Hubi, which runs as its own process
    (features/hubi/process.py) — start/stop it, desktop shortcut, autostart."""

    def hubi_get_state(self):
        from . import process

        from . import channel, claude_hooks

        try:
            hooks = claude_hooks.is_enabled(channel.get_token())
        except Exception:
            hooks = False
        process.refresh_shortcut_once()
        return {
            "running": process.is_running(),
            "autostart": process.autostart_enabled(),
            "shortcut": process.shortcut_exists(),
            "claude_hooks": hooks,
            "mascot": window.current_mascot(),
            "mascots": [{"id": k, "label": v} for k, v in window.MASCOTS],
            "size": window.current_size(),
            "sizes": list(window.SIZES),
            "follow_theme": window.follows_theme(),
            "sound": window.sound_enabled(),
            "codex_installed": codex_watch.ROOT.exists(),
            "codex_notify": codex_watch.notify_flag(),
            # The agent chosen in Paramètres IA, and whether Hubi follows it.
            **_agent_state(hooks),
        }

    def hubi_set_agent_notify(self, enabled):
        """One switch for « the AI agent »: Claude Code hooks or the Codex
        session watcher, depending on the CLI chosen in Paramètres IA."""
        from features.terminal.sessions import cli_kind

        kind = cli_kind()
        if kind == "claude":
            return self.hubi_set_claude_hooks(enabled)
        if kind == "codex":
            return self.hubi_set_option("codex_notify", enabled)
        return {"error": "Choisis Claude Code ou Codex dans Paramètres IA", **self.hubi_get_state()}

    def hubi_test_sound(self):
        from . import client, process

        if not process.is_running():
            return {"error": "Lance Hubi pour l'entendre"}
        if not client.send_sync("/event", {"kind": "sound_test"}):
            return {"error": "Hubi ne répond pas"}
        return {"ok": True}

    def hubi_set_option(self, key, value):
        """Dev Hub's Hubi page. Only writes config.json: the Hubi process
        reads these on its next poll (mascot, size, theme, sound)."""
        if key == "mascot" and value in dict(window.MASCOTS):
            window.set_mascot(value)
        elif key == "size" and value in window.SIZES:
            window.save_size(value)
        elif key == "follow_theme":
            window.set_follow_theme(bool(value))
        elif key == "sound":
            window.set_sound(bool(value))
        elif key == "codex_notify":
            config = load_config()
            config.setdefault("hubi", {})["codex_notify"] = bool(value)
            save_config(config)
        else:
            return {"error": "Réglage inconnu", **self.hubi_get_state()}
        return {"ok": True, **self.hubi_get_state()}

    def hubi_set_claude_hooks(self, enabled):
        from . import channel, claude_hooks

        try:
            if enabled:
                claude_hooks.enable(channel.get_token())
            else:
                claude_hooks.disable()
            result = {"ok": True}
        except Exception as e:
            result = {"error": f"Impossible de modifier ~/.claude/settings.json : {e}"}
        return {**result, **self.hubi_get_state()}

    # ------------------------------------------------------------ timer

    def hubi_timer_state(self):
        from . import timer

        state = timer.state()
        if state:
            state = {"end": int(state["end"] * 1000), "label": state["label"]}
        return {"timer": state}

    def hubi_timer_start(self, minutes, label=None):
        import time

        from . import client, process, timer

        try:
            seconds = int(round(float(minutes) * 60))
        except (TypeError, ValueError):
            return {"error": "Durée invalide"}
        if not 1 <= seconds <= timer.MAX_SECONDS:
            return {"error": "Durée entre 1 minute et 24 heures"}
        payload = {"action": "start", "seconds": seconds, "label": label or ""}
        if process.is_running():
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                if client.send_sync("/timer", payload):
                    return {"ok": True}
                time.sleep(0.4)
            return {"error": "Hubi ne répond pas"}
        # Hubi reads the persisted timer when it starts.
        if timer.persist(seconds, label) is None:
            return {"error": "Durée invalide"}
        if not process.launch():
            return {"error": "Impossible de lancer Hubi"}
        return {"ok": True, "launched": True}

    def hubi_timer_cancel(self):
        from . import client, process, timer

        if process.is_running() and client.send_sync("/timer", {"action": "cancel"}):
            return {"ok": True}
        timer.clear()
        return {"ok": True}

    # ------------------------------------------------------------ tasks

    def hubi_tasks_list(self):
        from . import tasks

        return {"tasks": tasks.list_tasks()}

    def _hubi_tasks_changed(self):
        from . import client

        client.send("/tasks/changed")
        return self.hubi_tasks_list()

    def hubi_task_add(self, text, project=None):
        from . import tasks

        task = tasks.add(text, project)
        if task is None:
            return {"error": "Tâche vide"}
        from . import client

        client.send("/event", {"kind": "task_noted", "message": task["text"]})
        return self._hubi_tasks_changed()

    def hubi_task_toggle(self, task_id):
        from . import tasks

        tasks.toggle(task_id)
        return self._hubi_tasks_changed()

    def hubi_task_set_project(self, task_id, project):
        from . import tasks

        tasks.set_project(task_id, project)
        return self._hubi_tasks_changed()

    def hubi_task_delete(self, task_id):
        from . import tasks

        tasks.delete(task_id)
        return self._hubi_tasks_changed()

    def hubi_set_running(self, running):
        from . import process

        if running:
            process.launch()
        else:
            process.stop()
        state = self.hubi_get_state()
        # launch() returns before the new process has written its pid file.
        if running:
            state["running"] = True
        return state

    def hubi_set_autostart(self, enabled):
        from . import process

        result = process.set_autostart(bool(enabled))
        return {**result, **self.hubi_get_state()}

    def hubi_set_shortcut(self, enabled):
        from . import process

        result = process.create_desktop_shortcut() if enabled else process.remove_desktop_shortcut()
        return {**result, **self.hubi_get_state()}

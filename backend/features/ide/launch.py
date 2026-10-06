import subprocess
import time
from pathlib import Path

from app_config import detect_default_ide, load_config, save_config
from core.platform import platform_svc
from features.git.run_git import safe_repo_file

from .detection import IDE_PROCESS_NAMES, ide_ipc_is_broken

IDE_LAUNCH_COOLDOWN_SECONDS = 5
_last_launch_at = {}


class IdeLaunchMixin:
    def list_terminals(self):
        return platform_svc.list_terminal_kinds()

    def open_terminal(self, path, kind="cmd"):
        return platform_svc.open_terminal_window(path, kind)

    def open_in_ide(self, path, ide=None):
        # A bare exception here would reach the js_api dispatcher unhandled;
        # depending on the pywebview/WebView2 version that can leave the JS
        # promise pending forever instead of rejecting it, so the "Ouvrir"
        # button spins indefinitely with no way to recover short of
        # reloading the whole window. Catching everything here guarantees
        # the frontend always gets a real answer to unblock its own state.
        try:
            return self._open_in_ide_impl(path, ide)
        except Exception as e:
            return {"error": f"Erreur inattendue à l'ouverture de l'IDE : {e}"}

    def open_file_in_ide(self, path, file, ide=None):
        # JetBrains launchers accept a file path in place of the project
        # path — they open the containing project (or focus it if already
        # open) and jump straight to that file, which is exactly what the
        # diff sheet's "Ouvrir dans ..." button wants.
        if not safe_repo_file(path, file):
            return {"error": "Chemin de fichier invalide"}
        try:
            return self._open_in_ide_impl(path, ide, target=str(Path(path) / file))
        except Exception as e:
            return {"error": f"Erreur inattendue à l'ouverture de l'IDE : {e}"}

    def _open_in_ide_impl(self, path, ide=None, target=None):
        target = target or path
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        launcher = ide or (repo["ide"] if repo else detect_default_ide(path))

        now = time.monotonic()
        last = _last_launch_at.get(launcher, 0)
        if now - last < IDE_LAUNCH_COOLDOWN_SECONDS:
            wait = round(IDE_LAUNCH_COOLDOWN_SECONDS - (now - last), 1)
            return {"error": f"{launcher} est en train de démarrer, réessaie dans {wait}s.", "log": f"Lancement {launcher} ignoré (cooldown)"}

        exe_name = IDE_PROCESS_NAMES.get(launcher)
        was_running = bool(exe_name and platform_svc.is_process_running(exe_name))

        if was_running and exe_name:
            # A hung existing instance is exactly what triggers JetBrains' own
            # DirectoryLock$CannotActivateException when we try to relaunch it
            # for a different project — Windows can tell us it's hung before
            # we even attempt that, so kill it and start fresh instead of
            # letting that crash happen.
            hwnd = platform_svc.find_any_window(exe_name)
            if hwnd and platform_svc.is_hung_window(hwnd):
                platform_svc.terminate_by_name(exe_name, force=True)
                time.sleep(0.5)
                was_running = False
            # If this exact project already has a window open, just focus it —
            # relaunching a running JetBrains IDE can trigger their own
            # DirectoryLock$CannotActivateException bug when the running
            # instance is busy/unresponsive, so avoid that relaunch entirely
            # when we don't actually need to open a different project.
            elif platform_svc.bring_to_front(exe_name, title_hint=Path(path).name, require_title_match=True):
                return {
                    "ok": True,
                    "log": f"{launcher} déjà ouvert sur ce projet — fenêtre remise au premier plan.",
                    "already_running": True,
                }
            elif ide_ipc_is_broken(launcher):
                # Relaunching now would just produce JetBrains' "still running
                # and does not respond" dialog. Say so instead, and offer the
                # only thing that actually fixes it.
                return {
                    "error": (
                        f"{launcher} tourne mais son canal interne est absent (fichier .port manquant), "
                        f"il ne peut pas ouvrir un autre projet. Redémarre l'IDE pour rétablir."
                    ),
                    "log": f"{launcher} : canal IPC absent, lancement évité",
                    "ide_restart_required": launcher,
                }

        # Different (or no) project currently open — invoke the launcher with
        # the target path. JetBrains launchers forward the path to the
        # existing instance over IPC, which is what actually opens the right
        # project instead of just refocusing whatever was already open.
        try:
            subprocess.Popen([launcher, target], shell=True, creationflags=subprocess.CREATE_NO_WINDOW)
            _last_launch_at[launcher] = now
            if ide and repo:
                repo["ide"] = ide
                save_config(config)
        except FileNotFoundError:
            return {
                "error": f"Launcher '{launcher}' introuvable. Génère les scripts shell depuis JetBrains Toolbox (Settings > Generate shell scripts).",
                "log": f"Échec lancement {launcher} : introuvable",
            }

        if was_running and exe_name:
            # Give the running instance a moment to process the IPC and
            # raise its own window before we try to force focus ourselves —
            # Windows' foreground-lock can block JetBrains' own activation.
            time.sleep(0.6)
            brought_front = platform_svc.bring_to_front(exe_name, title_hint=Path(path).name)
            return {
                "ok": True,
                "log": f"{launcher} — projet ouvert dans l'instance existante"
                + ("" if brought_front else " (bascule vers sa fenêtre si besoin : Alt+Tab)")
                + ".",
                "already_running": True,
            }

        return {"ok": True, "log": f"{launcher} lancé pour {Path(path).name}"}

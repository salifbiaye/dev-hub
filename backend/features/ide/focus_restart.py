import subprocess
import time
from pathlib import Path

from app_config import detect_default_ide, load_config
from core.platform import platform_svc

from .detection import IDE_PROCESS_NAMES
from .launch import _last_launch_at


class IdeFocusRestartMixin:
    def restart_ide(self, path, ide=None):
        """Close a running IDE and reopen it directly on `path`.

        Recovery for the case where the IDE is up but its single-instance
        channel is missing, so it can't be handed a new project.
        """
        try:
            return self._restart_ide_impl(path, ide)
        except Exception as e:
            return {"error": f"Erreur inattendue au redémarrage de l'IDE : {e}"}

    def _restart_ide_impl(self, path, ide=None):
        config = load_config()
        repo = next((r for r in config["repos"] if r["path"] == path), None)
        launcher = ide or (repo["ide"] if repo else detect_default_ide(path))
        exe_name = IDE_PROCESS_NAMES.get(launcher)
        if not exe_name:
            return {"error": f"IDE inconnu : {launcher}"}

        # Ask nicely first so the IDE can flush its state; force only if it
        # ignores that, since a hung instance is the usual reason we're here.
        platform_svc.terminate_by_name(exe_name, force=False)
        for _ in range(20):
            time.sleep(0.5)
            if not platform_svc.is_process_running(exe_name):
                break
        else:
            platform_svc.terminate_by_name(exe_name, force=True)
            time.sleep(1)

        try:
            subprocess.Popen([launcher, path], shell=True, creationflags=subprocess.CREATE_NO_WINDOW)
            _last_launch_at[launcher] = time.monotonic()
        except FileNotFoundError:
            return {"error": f"Launcher '{launcher}' introuvable."}
        return {"ok": True, "log": f"{launcher} redémarré sur {Path(path).name}"}

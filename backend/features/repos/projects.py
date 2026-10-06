import shutil
from pathlib import Path

import webview

from app_config import detect_default_ide, load_config, save_config


class ReposProjectsMixin:
    def list_repos(self):
        config = load_config()
        return [self._repo_info(repo) for repo in config["repos"]]

    def _repo_info(self, repo):
        path = repo["path"]
        name = repo.get("name") or Path(path).name
        return {**repo, "name": name, "status": self.git_status(path)}

    def add_repo(self, path, ide=None):
        if not path:
            return {"error": "Chemin vide"}
        config = load_config()
        if any(r["path"] == path for r in config["repos"]):
            return {"error": "Repo déjà ajouté"}
        if not (Path(path) / ".git").exists():
            return {"error": "Pas un dépôt git"}
        entry = {"path": path, "ide": ide or detect_default_ide(path)}
        config["repos"].append(entry)
        save_config(config)
        return self._repo_info(entry)

    def duplicate_repo(self, path):
        # A literal filesystem copy (including .git and any uncommitted
        # changes), not a fresh `git clone` — the point is duplicating the
        # project exactly as it sits right now, not resetting it to HEAD.
        src = Path(path)
        if not src.is_dir():
            return {"error": "Dossier introuvable"}
        parent = src.parent
        dest = None
        for i in range(1, 100):
            candidate = parent / (f"{src.name}-copie" if i == 1 else f"{src.name}-copie-{i}")
            if not candidate.exists():
                dest = candidate
                break
        if dest is None:
            return {"error": "Impossible de trouver un nom de dossier disponible"}
        try:
            shutil.copytree(src, dest)
        except OSError as e:
            return {"error": str(e)}
        return self.add_repo(str(dest))

    def scan_folder(self, root):
        if not root:
            return {"error": "Chemin vide"}
        root_path = Path(root)
        if not root_path.exists():
            return {"error": "Dossier introuvable"}

        config = load_config()
        existing = {r["path"] for r in config["repos"]}
        added = []

        candidates = [root_path, *sorted(p for p in root_path.iterdir() if p.is_dir())]
        for entry in candidates:
            if (entry / ".git").exists():
                path_str = str(entry)
                if path_str in existing:
                    continue
                config["repos"].append({"path": path_str, "ide": detect_default_ide(path_str)})
                existing.add(path_str)
                added.append(path_str)

        save_config(config)
        return {"added": len(added), "repos": added}

    def remove_repo(self, path):
        config = load_config()
        config["repos"] = [r for r in config["repos"] if r["path"] != path]
        for group in config["groups"]:
            group["repos"] = [p for p in group["repos"] if p != path]
        save_config(config)
        return {"ok": True}

    def pick_folder(self):
        result = webview.windows[0].create_file_dialog(webview.FileDialog.FOLDER)
        return result[0] if result else None

from app_config import load_config, save_config


class ReposGroupsMixin:
    def list_groups(self):
        config = load_config()
        return [{"name": g["name"], "repos": g["repos"], "count": len(g["repos"])} for g in config["groups"]]

    def create_group(self, name):
        name = (name or "").strip()
        if not name:
            return {"error": "Nom de groupe vide"}
        config = load_config()
        if any(g["name"] == name for g in config["groups"]):
            return {"error": "Groupe déjà existant"}
        config["groups"].append({"name": name, "repos": []})
        save_config(config)
        return {"ok": True, "name": name}

    def delete_group(self, name):
        config = load_config()
        config["groups"] = [g for g in config["groups"] if g["name"] != name]
        save_config(config)
        return {"ok": True}

    def rename_group(self, old_name, new_name):
        new_name = (new_name or "").strip()
        if not new_name:
            return {"error": "Nom de groupe vide"}
        config = load_config()
        if any(g["name"] == new_name for g in config["groups"]):
            return {"error": "Un groupe porte déjà ce nom"}
        group = next((g for g in config["groups"] if g["name"] == old_name), None)
        if not group:
            return {"error": "Groupe introuvable"}
        group["name"] = new_name
        save_config(config)
        return {"ok": True, "name": new_name}

    def group_repos(self, name):
        config = load_config()
        group = next((g for g in config["groups"] if g["name"] == name), None)
        if not group:
            return {"error": "Groupe introuvable"}
        by_path = {r["path"]: r for r in config["repos"]}
        return [self._repo_info(by_path[p]) for p in group["repos"] if p in by_path]

    def add_repo_to_group(self, name, path):
        config = load_config()
        group = next((g for g in config["groups"] if g["name"] == name), None)
        if not group:
            return {"error": "Groupe introuvable"}
        # A project belongs to one group at a time — joining a new one
        # reassigns it instead of piling up memberships, since the rest of
        # the UI (Projets sections, group badges, Stats) only ever shows a
        # single group per project and would silently hide it from any
        # group beyond the first otherwise.
        for g in config["groups"]:
            if g is not group and path in g["repos"]:
                g["repos"].remove(path)
        if path not in group["repos"]:
            group["repos"].append(path)
        save_config(config)
        return {"ok": True}

    def remove_repo_from_group(self, name, path):
        config = load_config()
        group = next((g for g in config["groups"] if g["name"] == name), None)
        if not group:
            return {"error": "Groupe introuvable"}
        group["repos"] = [p for p in group["repos"] if p != path]
        save_config(config)
        return {"ok": True}

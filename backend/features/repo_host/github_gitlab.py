import shutil
import subprocess
from pathlib import Path


class RepoHostMixin:
    def check_repo_host_cli(self):
        # gh/glab own their auth entirely (gh auth login / glab auth login
        # — a browser OAuth flow, token stored by the CLI itself) — Dev Hub
        # never sees a credential, it just shells out once the user has
        # already logged in, and needs to know which of the two are ready
        # so the "create repo" form can offer only what actually works.
        status = {}
        for name, binary in (("github", "gh"), ("gitlab", "glab")):
            installed = shutil.which(binary) is not None
            authenticated = False
            if installed:
                try:
                    result = subprocess.run(
                        [binary, "auth", "status"],
                        capture_output=True,
                        timeout=10,
                        creationflags=subprocess.CREATE_NO_WINDOW,
                    )
                    authenticated = result.returncode == 0
                except Exception:
                    authenticated = False
            status[name] = {"installed": installed, "authenticated": authenticated}
        return status

    def create_and_clone_repo(self, provider, name, visibility, description, parent_dir):
        name = (name or "").strip()
        parent_dir = (parent_dir or "").strip()
        if not name or not parent_dir:
            return {"error": "Nom et dossier requis"}
        if provider not in ("github", "gitlab"):
            return {"error": "Hébergeur inconnu"}
        binary = "gh" if provider == "github" else "glab"
        if shutil.which(binary) is None:
            return {"error": f"{binary} introuvable — installe-le puis connecte-toi (`{binary} auth login`)."}

        dest = Path(parent_dir) / name
        if dest.exists():
            return {"error": f"{dest} existe déjà"}

        args = [binary, "repo", "create", name, "--public" if visibility == "public" else "--private", "--clone"]
        if description:
            args += ["--description", description]

        try:
            result = subprocess.run(
                args,
                cwd=parent_dir,
                capture_output=True,
                text=True,
                timeout=60,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except Exception as e:
            return {"error": str(e)}

        if result.returncode != 0:
            return {"error": (result.stderr or result.stdout or "Échec de la création").strip()}

        if not (dest / ".git").exists():
            return {"error": f"Le dépôt a été créé sur {provider} mais le clonage local a échoué : {dest} introuvable"}

        return self.add_repo(str(dest))

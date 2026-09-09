# Portage cross-platform (Mac / Linux) — notes pour plus tard

Dev Hub est actuellement **Windows-only**. Ce doc liste tout ce qui est couplé à
Windows dans le code actuel, pour servir de check-list le jour où on veut
supporter Mac et/ou Linux. Rien de tout ça n'est fait — c'est juste un état
des lieux.

## Ce qui est Windows-only aujourd'hui

### 1. Terminal interactif (PTY)
- `pywinpty` (`winpty.PtyProcess`) = wrapper autour de ConPTY, Windows uniquement.
- Équivalent POSIX (Mac/Linux) : lib `ptyprocess` (API très proche : `spawn`,
  `.read()`, `.write()`, `.isalive()`, `.close()`).
- Il faudrait une couche d'abstraction (`if sys.platform == "win32": winpty else: ptyprocess`)
  car les deux libs n'ont pas exactement la même API.

### 2. Bring-to-front d'une fenêtre IDE déjà ouverte
- `win32gui` / `win32process` (`EnumWindows`, `SetForegroundWindow`, `AttachThreadInput`...)
  dans `_bring_to_front()` (main.py).
- Mac : passer par `osascript -e 'tell application "WebStorm" to activate'`
  (AppleScript, subprocess).
- Linux : pas d'API unifiée — dépend du window manager. `wmctrl -a <titre>`
  ou `xdotool search --name ... windowactivate` sont les options les plus
  courantes (nécessitent que l'outil soit installé, pas garanti par défaut).

### 3. Presse-papier (copier depuis le terminal)
- `win32clipboard` (`copy_to_clipboard()` dans main.py) — nécessaire car
  WebView2 charge l'app en `file://` et bloque `navigator.clipboard` /
  `execCommand('copy')` côté JS sans prompt de permission.
- Mac : `pbcopy` en subprocess (`echo text | pbcopy`, ou stdin pipe).
- Linux : `xclip -selection clipboard` ou `xsel --clipboard` (aucun n'est
  garanti installé par défaut selon la distro).
- Alternative plus simple si on porte un jour : la lib `pyperclip` gère déjà
  ces trois backends elle-même (mais introduit une dépendance de plus).
- À vérifier aussi : sur Mac/Linux, si l'app est servie via un vrai serveur
  HTTP local (`http://localhost:PORT`) plutôt que `file://`, `navigator.clipboard`
  pourrait fonctionner nativement — auquel cas le bridge Python devient inutile.
  Actuellement le mode dev (`DEV_HUB_DEV_URL`) sert déjà via Vite en `http://`,
  donc ça vaut le coup de tester si le clipboard JS marche tout seul dans ce cas.

### 4. Détection "process déjà lancé" (tasklist)
- `tasklist /FI "IMAGENAME eq ..."` dans `_is_process_running()` / `_get_pids_for_exe()`.
- Mac/Linux : `pgrep -f <nom>` ou `ps aux | grep`.

### 5. Lancement de commandes / résolution de chemin
- Tout passe par `cmd.exe /c "commande"` (`subprocess.Popen`, `winpty.PtyProcess.spawn`).
- Mac/Linux : `["/bin/sh", "-c", commande]` (ou `$SHELL` de l'utilisateur).
- Le bug qu'on a chassé cette session (`mvnw.cmd` bare vs `.\mvnw.cmd`) est
  spécifique à `cmd.exe` invoqué non-interactivement — sur bash/zsh la règle
  est différente mais tout aussi stricte : `./script.sh` est **toujours**
  obligatoire pour lancer un script du dossier courant (jamais de recherche
  implicite dans le `.`, question de sécurité shell). Donc le futur "wrapper
  scripts" (mvnw, gradlew) devra utiliser `./mvnw` (pas de `.cmd`) sur Unix.
- `subprocess.CREATE_NO_WINDOW` (anti-flash de console) est un flag Windows
  pur — no-op / à retirer conditionnellement sur Unix (pas de fenêtre console
  à masquer de toute façon).

### 6. Détection / lancement des IDE JetBrains
- Actuellement basé sur des noms d'exécutables Windows (`webstorm64.exe`,
  etc.) et sûrement des chemins d'installation Windows (Toolbox, Program Files).
- Mac : IDE dans `/Applications/WebStorm.app`, lancement via `open -a WebStorm <path>`.
- Linux : dépend de l'install (AppImage, snap, Toolbox) — pas de convention unique.

### 7. Emplacement de la config utilisateur
- `APP_DATA_DIR = LOCALAPPDATA/DevHub` (Windows).
- Mac : `~/Library/Application Support/DevHub`.
- Linux : `~/.config/DevHub` (respecter `XDG_CONFIG_HOME` si défini).

### 8. Packaging
- PyInstaller `--onefile --windowed` produit un `.exe` — sur Mac il produit
  un binaire Unix classique (pas un vrai `.app` bundle signé/notarisé sans
  config supplémentaire — `--windowed` sur Mac génère bien un `.app` mais sans
  icône Dock correcte ni notarisation Apple, donc Gatekeeper bloquera au
  premier lancement sans étape manuelle).
- Linux : PyInstaller produit un binaire ELF portable, mais pas de `.deb`/`.rpm`/
  AppImage automatiquement — il faudrait un outil séparé (`appimage-builder`
  par ex.) si on veut un vrai installeur.
- `pywebview` supporte Mac (Cocoa/WebKit) et Linux (GTK/Qt WebKit ou QtWebEngine)
  nativement, donc la partie fenêtre elle-même n'est pas bloquante — le gros du
  travail est le remplacement des dépendances win32 ci-dessus.

## Résumé de l'effort

Le cœur de l'app (React, logique de repos/groupes/env vars, config JSON,
génération de commit IA) est déjà 100% portable — aucun changement nécessaire.
Le travail de portage se limite à isoler les 6-7 points ci-dessus derrière un
`if sys.platform == "win32" / "darwin" / défaut linux`, remplacer chaque appel
win32 par son équivalent OS, et refaire un pipeline de build par OS.

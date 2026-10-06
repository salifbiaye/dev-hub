# Portage cross-platform (Mac / Linux)

## État actuel

- **Windows** : support complet, c'est la plateforme de référence.
- **Linux** : implémentation v1 faite (`backend/core/platform/linux/` +
  `backend/features/browser/linux/`), mais **jamais testée sur une vraie
  machine Linux** — écrite avec soin depuis un poste Windows, donc à
  valider avant de la considérer fiable. Différences connues par rapport à
  Windows :
  - Le navigateur intégré est simplifié : un onglet = une fenêtre pywebview
    classique (pas de barre d'adresse, pas d'onglets dans une seule fenêtre
    comme sur Windows — ce style-là repose sur WebView2/WinForms, sans
    équivalent direct en GTK/WebKit2).
  - Le focus de fenêtre IDE déjà ouverte dépend de `wmctrl` (best-effort,
    non garanti sous Wayland).
  - Le raccourci F11 plein écran global n'est pas disponible (capture de
    touche système non fiable sous X11/Wayland pour une app tierce).
  - Détection IDE/terminaux via `shutil.which` plutôt que des chemins
    d'installation figés.
- **macOS** : non commencé.

Build du `.exe` Windows : voir la section "Build de l'exécutable" du
[README](README.md). Build Linux : `pip install -r backend/requirements-linux.txt`
puis `python backend/main.py` (ou `pyinstaller backend/DevHub.linux.spec`),
à faire directement sur une machine/VM Linux.

## Ce qui était Windows-only avant le portage (pour référence)

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

## Résumé de l'effort (historique — désormais fait pour Linux, voir "État actuel" en haut)

Le cœur de l'app (React, logique de repos/groupes/env vars, config JSON,
génération de commit IA) était déjà 100% portable. Le travail de portage
s'est limité à isoler les points ci-dessus derrière `core/platform/`
(`windows/` et `linux/`), avec un `sys.platform` check au seul endroit qui
choisit l'implémentation. macOS suivrait le même principe (`core/platform/macos/`),
pas encore commencé.

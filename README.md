# Dev Hub

Un hub desktop pour développeurs qui jonglent avec plusieurs repos, plusieurs IDE et plusieurs projets à la fois — une seule fenêtre pour tout centraliser : ouverture d'IDE, git, bases de données, variables d'environnement, lancement de serveurs de dev, et sessions IA (Claude Code / Codex).

Construit avec **Python (pywebview)** pour le shell desktop et **React + Tailwind CSS** pour l'interface. Packagé en un seul exécutable Windows (`DevHub.exe`).

## Pourquoi

Quand on a plusieurs projets (front, back, side-projects...), chacun avec son propre IDE, sa propre base de données, ses propres variables d'env et sa propre commande de lancement, on finit par perdre du temps à jongler entre fenêtres. Dev Hub centralise tout ça dans un seul endroit, avec une interface rapide et personnalisable.

## Fonctionnalités

### Gestion de repos
- Liste de tous tes repos git, ajout manuel ou **scan automatique** d'un dossier parent (détecte tous les repos `.git` d'un coup)
- **Groupes** de repos (ex: regrouper le front et le back d'un même projet), renommables, avec badge de groupe visible sur chaque projet
- **Lancer un groupe entier** : sélection des projets à démarrer, chacun avec sa commande par défaut (marquable par projet), arrêt individuel ou global
- Statut git en direct : branche, ahead/behind, fichiers modifiés/non suivis, conflits
- **Recherche globale** (`Ctrl K`) : cherche un fichier ou une branche dans tous les projets à la fois, ouvre le résultat directement dans l'IDE configuré

### Git intégré
- Pull / Push / Commit directement depuis l'app
- **Génération de message de commit par IA** suivant les Conventional Commits (OpenAI, DeepSeek, Anthropic, ou un CLI déjà installé comme Claude Code / Codex — sans clé API séparée), avec sélecteur de langue
- Liste de branches, switch, et **fusion d'une branche dans la branche courante** en un clic
- **Historique des commits** consultable par projet, avec recherche par message/auteur/hash
- **Résolution de conflits** intégrée : vue côte-à-côte HEAD / entrant, édition directe, marquage résolu
- **Gestion de `.gitignore` / `.dockerignore`** : édition directe, ignorer un fichier ou un dossier entier en un clic (avec détachement du suivi git et aperçu du nombre de fichiers concernés avant confirmation)

### Bases de données
- Détection automatique depuis `.env`, `application.yml`, `schema.prisma`, `docker-compose.yml`… ou configuration manuelle avec test de connexion
- Support **PostgreSQL, MySQL/MariaDB, SQLite, MongoDB**
- Navigation des tables/collections avec filtres, tri, pagination
- Édition en place façon tableur (type-aware), insertion, suppression simple ou en masse, suivi des clés étrangères
- Éditeur SQL libre pour les requêtes brutes

### Ouverture d'IDE
- **Détection dynamique** des IDE installés (comme le "Ouvrir avec" de l'explorateur Windows) : WebStorm, IntelliJ IDEA, PyCharm, VS Code, Rider, GoLand, CLion, PhpStorm
- Sélecteur d'IDE par repo (mémorisé), avec gestion des instances déjà ouvertes (focus au lieu de relancer, détection de plantage/canal IPC cassé et proposition de redémarrage)
- **Terminal système** en un clic (CMD, PowerShell, ou Git Bash) directement à la racine d'un projet

### Variables d'environnement
- Détection automatique des fichiers `.env*` d'un repo
- Édition façon Vercel : valeurs masquées, révélation à la demande, ajout/suppression, sauvegarde qui préserve le reste du fichier

### Exécution de commandes (Run)
- Commandes nommées par repo (ex: `npm run dev`) avec variables d'env dédiées
- Terminal de logs en direct avec **coloration automatique**, recherche dans le terminal, copie
- Panneau **Processus** global : onglets réordonnables pour switcher entre toutes les commandes en cours, avec aperçu navigateur intégré (iframe, y compris les sites qui bloquent le framing) et détection automatique de l'URL locale
- Détection et nettoyage des **process orphelins**, et des profils WebView2 laissés par d'anciens lancements

### Sessions IA
- Terminal **interactif embarqué** (xterm.js + pseudo-terminal Windows natif) pour Claude Code / Codex / autre CLI, directement dans l'app
- Liste des sessions passées par repo, avec reprise en un clic

### Interface
- **17 thèmes** (dont plusieurs inspirés de Tokyo Night, Dracula, Nord, Catppuccin, Gruvbox…), persistés
- Barre de titre personnalisée, sans chrome Windows
- **Raccourcis clavier** (`Ctrl K` recherche, `Ctrl H` aide, `Échap` fermer)
- Zoom réglable, panneau de logs global

## Stack technique

- **Backend** : Python + [pywebview](https://pywebview.flowrl.com/) (fenêtre native via WebView2), [pywinpty](https://github.com/andfoy/pywinpty) pour le terminal intégré, psycopg2 / pymysql / pymongo pour les bases de données
- **Frontend** : React + Vite + Tailwind CSS v4, [xterm.js](https://xtermjs.org/) pour le terminal
- **Stockage** : `config.json` local dans `%LOCALAPPDATA%\DevHub\` — pas de base de données pour l'app elle-même

## Démarrage (développement)

Nécessite Python 3.10+ et Node.js 18+.

```bash
# Frontend
cd frontend
npm install
npm run dev          # démarre Vite sur http://localhost:5173

# Backend (dans un second terminal)
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
set DEV_HUB_DEV_URL=http://localhost:5173
.venv\Scripts\python main.py
```

## Build de l'exécutable

```bash
cd frontend
npm run build

cd ../backend
.venv\Scripts\python -m PyInstaller DevHub.spec --clean --noconfirm
```

L'exécutable est généré dans `backend/dist/DevHub.exe`.

## Structure du projet

```
dev-hub/
├── backend/          # API Python (pywebview), logique git/db/process/terminal
│   └── main.py
└── frontend/         # Interface React + Tailwind
    └── src/
        ├── App.jsx
        └── icons.jsx
```

## Licence

Projet personnel, usage libre.

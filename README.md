# Dev Hub

Un hub desktop pour développeurs qui jonglent avec plusieurs repos, plusieurs IDE et plusieurs projets à la fois — une seule fenêtre pour tout centraliser : ouverture d'IDE, git, variables d'environnement, lancement de serveurs de dev, et sessions IA (Claude Code / Codex).

Construit avec **Python (pywebview)** pour le shell desktop et **React + Tailwind CSS** pour l'interface.

## Pourquoi

Quand on a plusieurs projets (front, back, side-projects...), chacun avec son propre IDE, ses propres variables d'env et sa propre commande de lancement, on finit par perdre du temps à jongler entre fenêtres. Dev Hub centralise tout ça dans un seul endroit, avec une interface rapide et sombre (ou claire, au choix).

## Fonctionnalités

### Gestion de repos
- Liste de tous tes repos git, ajout manuel ou **scan automatique** d'un dossier parent
- **Groupes** de repos (ex: regrouper le front et le back d'un même projet), renommables
- Statut git en direct : branche, ahead/behind, fichiers modifiés/non suivis, conflits

### Git intégré
- Pull / Push / Commit directement depuis l'app
- **Génération de message de commit par IA** (OpenAI, DeepSeek, Anthropic, ou un CLI déjà installé comme Claude Code / Codex — sans clé API séparée)
- **Résolution de conflits** intégrée : vue côte-à-côte HEAD / entrant, édition directe, marquage résolu
- Liste et switch de branches

### Ouverture d'IDE
- Détection et lancement de WebStorm, IntelliJ IDEA, PyCharm, VS Code, Rider, GoLand, CLion, PhpStorm
- Sélecteur d'IDE par repo (mémorisé), avec protection anti double-lancement

### Variables d'environnement
- Détection automatique des fichiers `.env*` d'un repo
- Édition façon Vercel : valeurs masquées, révélation à la demande, ajout/suppression, sauvegarde qui préserve le reste du fichier

### Exécution de commandes (Run)
- Commandes nommées par repo (ex: `npm run dev`) avec variables d'env dédiées
- Terminal de logs en direct avec **coloration automatique** (erreurs en rouge, warnings en orange, info en bleu)
- Panneau **Processus** global : onglets pour switcher entre toutes les commandes en cours, avec aperçu navigateur intégré (iframe) et détection automatique de l'URL locale
- Détection et nettoyage des **process orphelins** (au cas où un arrêt aurait échoué)

### Sessions IA
- Terminal **interactif embarqué** (xterm.js + pseudo-terminal Windows natif) pour Claude Code / Codex / autre CLI, directement dans l'app
- Liste des sessions Claude Code passées par repo, avec reprise en un clic

### Interface
- Thème clair / sombre / système, avec persistance
- Zoom réglable
- Panneau de logs global pour tout tracer

## Stack technique

- **Backend** : Python + [pywebview](https://pywebview.flowrl.com/) (fenêtre native via WebView2), [pywinpty](https://github.com/andfoy/pywinpty) pour le terminal intégré
- **Frontend** : React + Vite + Tailwind CSS v4, [xterm.js](https://xtermjs.org/) pour le terminal
- **Stockage** : `config.json` local dans `%LOCALAPPDATA%\DevHub\`

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
pip install pyinstaller
pyinstaller --onefile --windowed --name DevHub --icon icon.ico --add-data "..\frontend\dist;frontend/dist" --collect-all winpty main.py
```

L'exécutable est généré dans `backend/dist/DevHub.exe`.

## Structure du projet

```
dev-hub/
├── backend/          # API Python (pywebview), logique git/process/terminal
│   └── main.py
└── frontend/         # Interface React + Tailwind
    └── src/
        ├── App.jsx
        └── icons.jsx
```

## Licence

Projet personnel, usage libre.

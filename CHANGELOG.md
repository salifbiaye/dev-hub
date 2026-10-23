# Changelog

Notes de chaque release Dev Hub. Rempli au fil du développement dans la
section "Non publié", puis basculé dans une nouvelle section datée au
moment du `./release.sh` (le contenu sert directement de notes de release).

## Non publié

## [0.8.0] - 2026-10-23

### ✨ Nouveautés
- **Sessions IA en panneaux** : l'onglet IA se divise comme on veut (à droite ou en bas, autant de fois qu'on veut) pour faire tourner plusieurs sessions côte à côte. Chaque panneau reprend une ancienne session ou en démarre une nouvelle, les séparateurs se déplacent à la souris
- **Onglet Env refait** : les fichiers `.env` sont rangés par dossier dans un cadre, les variables s'affichent dans un tableau Clé / Valeur, et un bandeau récapitule les modifications en attente (ajoutée, modifiée, supprimée) avant de les appliquer
- **Onglet Code : suppression** de fichiers et de dossiers depuis l'arborescence, avec une confirmation
- **Onglet Code : Ctrl+clic** sur un import ou sur un nom importé ouvre le fichier correspondant (chemins relatifs, alias `@/`, projets dans un sous-dossier)
- Un fichier qui ne peut pas être affiché (trop volumineux, binaire) montre maintenant un message avec Hubi au lieu d'une ligne rouge

## [0.7.0] - 2026-10-22

### ✨ Nouveautés
- **Variables d'environnement des sous-dossiers** : l'onglet Env cherche les `.env` dans tout le projet (monorepo : `backend/`, `frontend/`…), groupés par dossier avec le type de projet reconnu (Node, Java Maven, Python, Go, PHP, Docker…). On voit de quel dossier vient chaque fichier, et « Nouveau .env » crée un fichier au bon endroit
- **Requêtes SQL en onglets** : plusieurs requêtes en parallèle, chacune avec son texte et son résultat, retrouvées au redémarrage
- **Onglet Code** : la recherche (Ctrl+F) marche aussi en mode Modifier, avec les occurrences surlignées et Entrée / Maj+Entrée pour passer de l'une à l'autre ; autocomplétion dans l'éditeur
- Le plein écran du Code, de la base de données, du diagramme et du terminal s'arrête sous la barre d'onglets, qui reste utilisable

### 🐛 Corrections
- Navigateur de Dev Hub : en quittant le plein écran (F11), la fenêtre retrouve son accrochage aux bords de l'écran (Snap), sa bordure et ses coins arrondis
- Sessions IA : le terminal démarre à la bonne taille, la première image de Claude Code ne sort plus décalée
- Fenêtre noire au démarrage : détectée et rechargée plus vite (8 s au lieu de 24 s), et la page est servie sur l'adresse IPv4 directe pour éviter un premier chargement qui restait noir

## [0.6.3] - 2026-10-20

### 🐛 Corrections
- Fenêtre Dev Hub noire : si la page arrête de se dessiner alors que la fenêtre est affichée, elle se recharge toute seule (sauf si une modification de l'onglet Code n'est pas enregistrée)
- Hubi gardait comme « au travail » une session Claude interrompue (Échap), coupée par la limite d'usage ou tuée : elle est retirée du badge après 2 minutes sans activité, et revient toute seule si elle reprend

## [0.6.2] - 2026-10-19

### ✨ Nouveautés
- Hubi compte aussi les sous-agents au travail : en plus des sessions (« ● 2 Claude »), son badge affiche les agents lancés par une session qui travaillent encore (« ● 8 agents »), mis à jour toutes les 5 secondes

## [0.6.1] - 2026-10-15

### ✨ Nouveautés
- Dev Hub ne s'ouvre plus qu'une fois : le relancer ramène la fenêtre déjà ouverte au premier plan

### 🐛 Corrections
- Barre rapide de Hubi (Ctrl+Alt+H) : s'ouvre instantanément, directement au centre de l'écran et aux couleurs du thème (plus de passage par la gauche ni de flash d'un autre thème)

## [0.6.0] - 2026-10-15

### ✨ Nouveautés
- **Onglets façon Explorateur Windows** : chaque onglet est un Dev Hub complet qui garde son état (projet, fichier ouvert, logs). Glisser pour réordonner, Ctrl+T / Ctrl+W / Ctrl+Tab / Ctrl+1…9, onglets rouverts au redémarrage
- **Hubi, le compagnon de bureau** : un petit personnage qui flotte dans un coin de l'écran, même Dev Hub fermé. 14 humeurs, il suit tes sessions Claude Code et Codex (nombre de sessions en cours, fin, erreur, réponse attendue), tes runs et ton minuteur, avec bulles et sons
- Hubi : **tâches** par projet ajoutées de n'importe où (Ctrl+Alt+H, `@projet`), lancées dans une nouvelle session Claude/Codex ou une session existante
- Hubi : page dédiée dans Dev Hub — mascotte clair / graphite / auto, tailles, **mascotte seule sans cadre** (vraie transparence, les clics à côté passent aux fenêtres dessous), visible sur tous les bureaux virtuels, démarrage avec Windows, raccourci bureau
- **Codex** au même niveau que Claude Code : sessions listées et reprises, tâches, notifications Hubi ; Paramètres IA séparés en agents et « messages de commit uniquement »
- Onglet Code : **édition des fichiers** (Ctrl+S) et **aperçu Markdown / HTML**, explorateur élargissable
- Exécution : quand un **port est déjà utilisé**, Dev Hub montre qui le tient (et ce qui l'a lancé) et le libère en un clic avant de relancer
- Fenêtres Dev Hub et navigateur reconnues par Windows (Snap, glisser natif, bordure) ; menus Outils et + Ajouter ; actualisation avec squelette ; panneau Processus propre à l'onglet qui l'ouvre
- Navigateur intégré : indicateur de chargement et page d'erreur aux couleurs du thème
- Formulaire de connexion BDD plus lisible

### 🐛 Corrections
- Génération du message de commit IA qui restait bloquée
- Commit qui échouait sur un fichier disparu ou une suppression déjà indexée (« pathspec did not match any files »)
- Fenêtres Dev Hub ou Hubi parfois noires (après un changement de bureau virtuel ou une sortie de veille)
- Vue Code vide sur certains fichiers modifiés (fins de ligne), et ouvrir un fichier ne retire plus un fichier de la zone de staging
- Barre rapide de Hubi en « Error 404 » ; nettoyage des dossiers temporaires laissés par Dev Hub

## [0.5.0] - 2026-10-06

### ✨ Nouveautés
- Support Linux expérimental (v1) : presse-papier, terminal intégré, détection de process, lancement de commandes — navigateur intégré simplifié (un onglet = une fenêtre) en attendant une version complète façon Windows. Pas encore testé sur une vraie machine Linux, à prendre comme un premier jet
- Résolution de conflits : diff coloré (ajouts/suppressions) entre la version actuelle et entrante par rapport à la base commune, au lieu de deux blocs de texte brut

### 🐛 Corrections
- Commit qui refusait de passer dès qu'un fichier supprimé était coché ("pathspec did not match any files")

## [0.4.0] - 2026-09-25

### ✨ Nouveautés
- Bouton "Créer un repo" : crée et clone un dépôt GitHub ou GitLab en un formulaire (nom, visibilité, description, dossier), via `gh`/`glab` déjà connectés — Dev Hub ne touche à aucun identifiant
- Onglet BDD : export d'une table (ou du résultat d'une requête SQL) vers Excel, en respectant les filtres/recherche actifs
- Onglet BDD : import d'un fichier CSV/Excel pour insérer des lignes en masse dans une table
- Onglet BDD : tri par colonne (clic sur l'en-tête), recherche rapide dans toutes les colonnes
- Onglet BDD : dupliquer une ligne (pré-remplit le formulaire d'ajout au lieu d'insérer directement, pour les tables avec identifiant obligatoire)
- Onglet BDD : copier une ligne au format JSON
- Onglet BDD : requêtes SQL favorites (sauvegarder/recharger/supprimer)
- Onglet BDD : export du schéma complet en `.sql`, et export du diagramme de schéma en image (qualité conservée même avec beaucoup de tables)
- Onglet BDD : plein écran pour tout le panneau (tables, SQL et schéma), pas seulement le diagramme
- L'icône plein écran/restaurer de la fenêtre change maintenant réellement selon l'état (agrandie ou non), pour Dev Hub et son navigateur intégré

### 🐛 Corrections
- Recherche BDD en erreur sur une colonne de type `uuid` ("operator does not exist: uuid ~~* unknown")
- Import CSV/Excel qui semblait ne rien faire au clic (filtre de fichier invalide, la fenêtre de sélection ne s'ouvrait jamais)

## [0.3.0] - 2026-09-18

### ✨ Nouveautés
- Nouveau navigateur intégré à Dev Hub pour prévisualiser les apps lancées depuis Processus (façon Burp Suite), sans les limites de session d'un aperçu classique : vrais onglets indépendants les uns des autres, réordonnables par glisser-déposer, avec favicons, page de nouvel onglet listant les sites les plus visités, bascule vue mobile/bureau, barre d'adresse avec suggestions (historique + recherche web), suit le thème de Dev Hub, et propose d'enregistrer les mots de passe
- Nouvel onglet Contributeurs : commits par auteur, par branche
- Onglet BDD : schéma visuel des tables et de leurs relations, diagramme interactif et déplaçable
- Onglet Code : l'arborescence montre maintenant tous les fichiers du projet (avant, seuls les fichiers suivis/non ignorés par git étaient visibles)
- Onglet Code : aperçu des images, vidéos, audio et PDF au lieu de "fichier binaire"
- Onglet Code : coloration syntaxique, recherche rapide de fichier (Ctrl+P), recherche dans le fichier ouvert (Ctrl+F), copier le chemin absolu

### 🐛 Corrections
- Lancer un run avec une URL configurée depuis l'onglet Exécution affichait le nom du projet à la place de l'URL dans l'aperçu

## [0.2.3] - 2026-09-11

### ✨ Nouveautés
- Panneau Commit : sélection des fichiers à commit (cases à cocher + groupes Nouveaux/Modifiés/Conflits avec sélection en bloc), au lieu de tout commit systématiquement
- "Générer avec l'IA" ne décrit plus que le diff des fichiers sélectionnés
- Panneau Commit : diff dépliable par fichier (couleurs + numéros de ligne), et panneau latéral pour voir le fichier complet avec bouton "Ouvrir dans l'IDE"
- Thèmes GitHub Dark, GitHub Light et WebStorm ajoutés
- Git Stash : mettre de côté des fichiers sélectionnés, liste des stash avec Appliquer/Pop/Supprimer
- Nouvel onglet "Code" : arborescence du projet, aperçu d'un fichier en lecture seule avec recherche, bouton "Ouvrir dans l'IDE", plein écran, sélection/copie de texte
- Onglet Code : badge de statut git (M/A) sur les fichiers modifiés dans l'arborescence, et diff surligné (au lieu du contenu brut) pour les fichiers non commités
- Onglet Code : bouton pour copier la sélection (ou tout le fichier) dans le presse-papier

### 🐛 Corrections
- Onglet Branches : le diff pouvait démarrer scrollé loin à droite au lieu du début
- Highlight des lignes ajoutées/supprimées qui ne suivait pas le scroll horizontal
- Gestion des conflits : un fichier encore marqué `<<<<<<<` ne peut plus être "marqué résolu" par erreur ; confirmation ajoutée avant "Annuler le merge"
- Bouclier (proxy) désactivé pour les URLs locales — il cassait les images/ressources d'un serveur de dev local
- Aperçu d'un serveur local (`localhost:3000`) qui refusait parfois de se connecter dans Dev Hub alors qu'il marchait dans le navigateur (proxy système sans exception pour localhost)
- Erreur de connexion BDD affichée comme un bandeau brut au lieu d'un message clair

## [0.2.2] - 2026-09-10

### ✨ Nouveautés
- Onglet Branches : chaque branche affiche son dernier commit (hash + message) pour distinguer deux branches ayant le même écart avec origin/main mais pas les mêmes commits
- Onglet Branches : animation de chargement au lieu du texte "Chargement…"

### 🐛 Corrections
- Scrollbar horizontale parasite en haut de la fenêtre
- Onglet Branches lent (~3s) et rechargeant à chaque changement d'onglet : le fetch réseau ne se déclenche plus qu'au clic sur "Rafraîchir"

## [0.2.1] - 2026-09-10

### ✨ Nouveautés
- Scrollbar personnalisée dans toute l'app

### 🐛 Corrections
- Boutons flèches et coin de la scrollbar (délimiteurs visibles) enfin masqués
- Bouton "Ajouter à…" de la sélection multiple peu lisible (contraste trop faible)

## [0.2.0] - 2026-09-10

### ✨ Nouveautés
- 25 thèmes disponibles, icône de la barre des tâches adaptée au thème actif
- Stats CPU/RAM en direct par projet, avec carte "Total" cumulé
- Listes Projets/Groupes/Stats en lignes denses et regroupées, avec sélection multiple
- Branches et statut git visibles directement dans la liste des projets
- Fusion de branche en un clic, historique des commits, gestion de `.gitignore`/`.dockerignore`
- Plein écran (F11) — natif et pour le terminal IA, avec couleurs correctement affichées
- Vérification automatique des mises à jour au démarrage

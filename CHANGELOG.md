# Changelog

Notes de chaque release Dev Hub. Rempli au fil du développement dans la
section "Non publié", puis basculé dans une nouvelle section datée au
moment du `./release.sh` (le contenu sert directement de notes de release).

## Non publié

## [0.10.0] - 2026-11-18

### ✨ Nouveautés

#### Projet : Aperçu, icônes et onglets adaptés
- **Onglet Aperçu** (premier onglet) à la manière d'un profil GitHub : grande icône du projet, branche, chiffres (commits, branches, contributeurs, dernier commit), langages, contributeurs et **carte d'activité** (un carré par jour, du lundi au dimanche, sur 12 mois ou une année entière, pour tous ou seulement pour toi)
- **Historique dans l'Aperçu**, en deux vues : « Liste » (pages numérotées, filtres texte / année / mois / auteur) et « Graphique » (évolution des commits par personne : « Comparer » période par période, « Cumulé » avec le total qui monte, périodes de 30 jours à tout l'historique, couleurs qui suivent le thème). L'onglet Historique disparaît
- **Icône personnalisée** pour un projet ou un groupe (clic sur l'icône à côté du nom) : elle remplace le dossier dans l'onglet du projet (comme un favicon), les listes et l'accueil
- **Onglets adaptés au projet** : Dev Hub détecte le type de projet et n'affiche que les onglets utiles ; le bouton « + » permet d'ajouter ou masquer BDD, Tests, Tâches et Requêtes par projet
- **États vides encadrés avec Hubi** (en veille) dans les Requêtes, l'historique et les TODO du code

#### Nouveaux onglets
- **Tests** : détecte la commande (`npm test`, `mvnw test`, `gradlew test`, `pytest`, `go test`, `cargo test`), la lance et affiche réussis / échoués / ignorés, puis chaque échec avec un lien vers le fichier et la ligne ; « Corriger avec l'IA »
- **Requêtes** (un mini Postman pour l'API du projet) : méthode, URL, paramètres, en-têtes, corps JSON, Bearer ; réponse avec statut, durée, taille et JSON coloré ; **environnements** (Local, Staging, Production… avec leur URL et leurs variables) ; **collection** en dossiers (glisser-déposer, renommage), onglets de requêtes, plein écran ; **import / export** Postman v2.1 et Insomnia v4 ; « Importer les routes » depuis l'OpenAPI du serveur ou, serveur éteint, lues dans le code (Spring, NestJS, Express, FastAPI, Flask, Django, Go, Laravel, ASP.NET)
- **Tâches** : les tâches Hubi du projet (avec « Lancer avec Claude / Codex » et « Reprendre une session »), les `TODO` / `FIXME` du code et des notes libres, gardées dans Dev Hub (rien n'est écrit dans le dépôt)

#### Code
- **Éditeur de code comme un vrai IDE** (CodeMirror 6) : langage reconnu, erreurs de syntaxe soulignées, et la lecture seule a le même style que le mode Modifier, avec les modifications non commitées affichées directement
- **Terminal intégré** en bas de l'onglet (PowerShell, CMD, Git Bash), plusieurs terminaux en onglets ; **recherche dans tout le projet** (Ctrl+Maj+F) ; **onglets de fichiers** restaurés à la réouverture ; mise à jour automatique quand un fichier change ailleurs ; « Demander à l'IA » sur un fichier ; vraies icônes par type de fichier
- En-tête du fichier adaptatif sur fenêtre étroite

#### IA et Hubi
- **Barre de composition** sous les sessions Claude / Codex (« / » pour les skills et commandes, images et fichiers, mode de permission), **Paramètres IA repensés** (enregistrement automatique) et **comptes Claude et Codex** (connexion depuis l'app, liste des comptes, compte actif)
- **Choix Claude / Codex** à chaque lancement ; les **sessions Codex réapparaissent** (lues dans leur base SQLite) ; Hubi suit Claude et Codex en même temps
- **Hubi en « île »** (pastille en haut de l'écran, façon Dynamic Island) ; **Ctrl+Alt+H** fonctionne sur les bureaux virtuels (la barre apparaît là où tu es, le voile sombre ne reste plus bloqué)
- **Palette de commandes** (Ctrl+K) enrichie d'actions et de commandes par projet ; bloc **« À surveiller »** sur l'accueil (conflits, à commiter, à pousser, à récupérer)

### 🐛 Corrections
- Dev Hub **oubliait ses onglets** et ses réglages d'interface à chaque fermeture : ils sont maintenant sauvegardés et restaurés au redémarrage
- « … is not a function » au démarrage de l'app
- Le « + » du terminal intégré n'ouvrait rien ; les icônes de prompt (oh-my-posh) s'affichent avec ta Nerd Font
- Nom d'un groupe invisible dans l'en-tête de sa page
- « Envoyer à Claude » depuis une tâche Hubi ne basculait pas sur l'onglet IA
- La barre d'ajout rapide Ctrl+Alt+H était trop grande sur un affichage mis à l'échelle (125 %, 150 %)
- Plusieurs icônes Hubi dans la zone de notification

## [0.9.0] - 2026-10-28

### ✨ Nouveautés
- **Onglet Code : renommer** un fichier ou un dossier depuis l'arborescence (crayon au survol, ou F2 sur le fichier sélectionné). Le fichier ouvert et le statut git suivent le nouveau nom ; Dev Hub refuse un nom déjà pris, un nom invalide ou un renommage pendant une modification non enregistrée
- **Onglet Env : copier une variable** — la valeur, la ligne `KEY=valeur` ou le nom, avec une coche de confirmation plutôt qu'une notification
- **Onglet Env : exporter** — copier toutes les variables ou le modèle `.env.example` (clés sans valeurs), créer `.env.example` à côté du fichier (commentaires conservés, confirmation avant de remplacer), ou enregistrer le fichier où l'on veut, avec ou sans les valeurs

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

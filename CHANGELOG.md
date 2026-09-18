# Changelog

Notes de chaque release Dev Hub. Rempli au fil du développement dans la
section "Non publié", puis basculé dans une nouvelle section datée au
moment du `./release.sh` (le contenu sert directement de notes de release).

## Non publié

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

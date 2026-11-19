## ✨ Nouveautés

### Projet : Aperçu, icônes et onglets adaptés
- **Onglet Aperçu** (premier onglet) à la manière d'un profil GitHub : grande icône du projet, branche, chiffres (commits, branches, contributeurs, dernier commit), langages, contributeurs et **carte d'activité** (un carré par jour, du lundi au dimanche, sur 12 mois ou une année entière, pour tous ou seulement pour toi)
- **Historique dans l'Aperçu**, en deux vues : « Liste » (pages numérotées, filtres texte / année / mois / auteur) et « Graphique » (évolution des commits par personne : « Comparer » période par période, « Cumulé » avec le total qui monte, périodes de 30 jours à tout l'historique, couleurs qui suivent le thème). L'onglet Historique disparaît
- **Icône personnalisée** pour un projet ou un groupe (clic sur l'icône à côté du nom) : elle remplace le dossier dans l'onglet du projet (comme un favicon), les listes et l'accueil
- **Onglets adaptés au projet** : Dev Hub détecte le type de projet et n'affiche que les onglets utiles ; le bouton « + » permet d'ajouter ou masquer BDD, Tests, Tâches et Requêtes par projet
- **États vides encadrés avec Hubi** (en veille) dans les Requêtes, l'historique et les TODO du code

### Nouveaux onglets
- **Tests** : détecte la commande (`npm test`, `mvnw test`, `gradlew test`, `pytest`, `go test`, `cargo test`), la lance et affiche réussis / échoués / ignorés, puis chaque échec avec un lien vers le fichier et la ligne ; « Corriger avec l'IA »
- **Requêtes** (un mini Postman pour l'API du projet) : méthode, URL, paramètres, en-têtes, corps JSON, Bearer ; réponse avec statut, durée, taille et JSON coloré ; **environnements** (Local, Staging, Production… avec leur URL et leurs variables) ; **collection** en dossiers (glisser-déposer, renommage), onglets de requêtes, plein écran ; **import / export** Postman v2.1 et Insomnia v4 ; « Importer les routes » depuis l'OpenAPI du serveur ou, serveur éteint, lues dans le code (Spring, NestJS, Express, FastAPI, Flask, Django, Go, Laravel, ASP.NET)
- **Tâches** : les tâches Hubi du projet (avec « Lancer avec Claude / Codex » et « Reprendre une session »), les `TODO` / `FIXME` du code et des notes libres, gardées dans Dev Hub (rien n'est écrit dans le dépôt)

### Code
- **Éditeur de code comme un vrai IDE** (CodeMirror 6) : langage reconnu, erreurs de syntaxe soulignées, et la lecture seule a le même style que le mode Modifier, avec les modifications non commitées affichées directement
- **Terminal intégré** en bas de l'onglet (PowerShell, CMD, Git Bash), plusieurs terminaux en onglets ; **recherche dans tout le projet** (Ctrl+Maj+F) ; **onglets de fichiers** restaurés à la réouverture ; mise à jour automatique quand un fichier change ailleurs ; « Demander à l'IA » sur un fichier ; vraies icônes par type de fichier
- En-tête du fichier adaptatif sur fenêtre étroite

### IA et Hubi
- **Barre de composition** sous les sessions Claude / Codex (« / » pour les skills et commandes, images et fichiers, mode de permission), **Paramètres IA repensés** (enregistrement automatique) et **comptes Claude et Codex** (connexion depuis l'app, liste des comptes, compte actif)
- **Choix Claude / Codex** à chaque lancement ; les **sessions Codex réapparaissent** (lues dans leur base SQLite) ; Hubi suit Claude et Codex en même temps
- **Hubi en « île »** (pastille en haut de l'écran, façon Dynamic Island) ; **Ctrl+Alt+H** fonctionne sur les bureaux virtuels (la barre apparaît là où tu es, le voile sombre ne reste plus bloqué)
- **Palette de commandes** (Ctrl+K) enrichie d'actions et de commandes par projet ; bloc **« À surveiller »** sur l'accueil (conflits, à commiter, à pousser, à récupérer)

## 🐛 Corrections
- Dev Hub **oubliait ses onglets** et ses réglages d'interface à chaque fermeture : ils sont maintenant sauvegardés et restaurés au redémarrage
- « … is not a function » au démarrage de l'app
- Le « + » du terminal intégré n'ouvrait rien ; les icônes de prompt (oh-my-posh) s'affichent avec ta Nerd Font
- Nom d'un groupe invisible dans l'en-tête de sa page
- « Envoyer à Claude » depuis une tâche Hubi ne basculait pas sur l'onglet IA
- La barre d'ajout rapide Ctrl+Alt+H était trop grande sur un affichage mis à l'échelle (125 %, 150 %)
- Plusieurs icônes Hubi dans la zone de notification

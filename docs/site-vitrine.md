# Site vitrine Dev Hub — brief complet

Document à donner tel quel à un générateur de site (v0, Lovable, Bolt…) ou à un
designer. La partie 8 est un prompt prêt à coller ; les parties 1 à 7 donnent
tout le contenu et le contexte.

---

## 1. Le projet en une phrase

**Dev Hub** est une application de bureau gratuite pour développeurs qui
réunit dans une seule fenêtre tout ce qu'on ouvre d'habitude dans dix :
projets git, IDE, bases de données, variables d'environnement, serveurs de dev,
sessions IA (Claude Code, Codex) — avec **Hubi**, un petit compagnon qui flotte
sur le bureau et te prévient quand ton IA a fini ou attend ta réponse.

- Version actuelle : **v0.6.0** — Windows 10 / 11 (64 bits)
- **macOS et Linux : bientôt**
- Gratuit, usage libre, code source sur GitHub
- Auteur : Salif Biaye — https://github.com/salifbiaye/dev-hub

## 2. Pour qui

Les développeurs qui jonglent avec plusieurs projets en même temps (un front,
un back, des side-projects…), chacun avec son IDE, sa base de données, ses
`.env` et sa commande de lancement — et qui travaillent avec des agents IA en
ligne de commande (Claude Code, Codex).

## 3. Style visuel

- **Thème sombre** par défaut, sobre et net, inspiration Linear / Raycast :
  beaucoup d'espace, peu de bordures, typographie soignée.
- Couleurs (celles de l'app) :
  - fond `#0a0a0c`, surfaces `#111114`, bordures `#232327`
  - texte `#ededf0`, texte secondaire `#8b8b93`
  - **accent violet `#6e56cf`** (survol `#7c66db`), vert succès `#3ddc8c`
- Polices : **Inter** (texte), **JetBrains Mono** (code, raccourcis clavier).
- Hubi (la mascotte) apporte la touche ludique : corps blanc arrondi, deux
  yeux ovales, il peut tenir une tablette. À utiliser comme personnage du site
  (hero, sections, page 404…), sans en faire trop.
- Raccourcis clavier affichés comme des touches (`Ctrl` `K`).
- Animations discrètes (apparition au scroll, léger flottement de Hubi).
- Responsive (mobile : on présente l'app, le bouton de téléchargement indique
  « Disponible sur Windows »).

## 4. Liens et ressources

| Ressource | Lien |
|---|---|
| **Télécharger l'exe (toujours la dernière version)** | https://github.com/salifbiaye/dev-hub/releases/latest/download/DevHub.exe |
| Page des versions | https://github.com/salifbiaye/dev-hub/releases |
| Code source | https://github.com/salifbiaye/dev-hub |
| Nouveautés (changelog) | https://github.com/salifbiaye/dev-hub/blob/main/CHANGELOG.md |
| Logo Dev Hub (PNG) | https://raw.githubusercontent.com/salifbiaye/dev-hub/main/backend/icon.png |
| Icône de Hubi (PNG transparent) | https://raw.githubusercontent.com/salifbiaye/dev-hub/main/frontend/public/hubi/hubi-icon.png |
| Les 14 humeurs de Hubi (grille) | https://raw.githubusercontent.com/salifbiaye/dev-hub/main/docs/mascot/humeurs.png |
| Aperçus de Hubi (clair / graphite) | `docs/mascot/` du dépôt |
| Vidéo de présentation v0.6 | fichier `devhub-annonce-v20.MP4` (à héberger sur le site lui-même) — aussi visible sur GitHub : https://github.com/user-attachments/assets/12c5edf0-ff98-4a78-910f-799488eea85c |

**Toutes les images prêtes à l'emploi** sont dans `docs/site-assets/` (logo,
favicon, image de partage 1200×630, Hubi, ses 14 humeurs une par une sur fond
transparent) — voir `docs/site-assets/LISEZMOI.md` pour savoir laquelle mettre
où.

Taille de l'exe : ~33 Mo. Le lien `releases/latest/download/DevHub.exe` pointe
toujours vers la dernière version publiée : pas besoin de mettre à jour le site
à chaque release.

> La vidéo : mieux vaut l'héberger avec le site (fichier MP4 dans les assets,
> balise `<video autoplay muted loop playsinline>`) ; les liens
> `user-attachments` de GitHub sont faits pour GitHub, pas pour être intégrés
> ailleurs.

## 5. Structure et textes du site (en français)

### Barre de navigation
Logo + « Dev Hub » · Fonctionnalités · Hubi · FAQ · GitHub ·
bouton **Télécharger**

### Hero
- Titre : **Tous tes projets. Une seule fenêtre.**
- Sous-titre : Dev Hub réunit tes repos git, tes IDE, tes bases de données,
  tes serveurs de dev et tes sessions IA dans une app de bureau rapide — avec
  Hubi, un compagnon qui te prévient quand ton IA a fini.
- Bouton principal : **Télécharger pour Windows** (v0.6.0 · 33 Mo) → lien exe
- Bouton secondaire : **Voir sur GitHub**
- Mention sous les boutons : *macOS et Linux : bientôt · Gratuit*
- Visuel : la vidéo de présentation (ou une capture de l'app) dans un cadre de
  fenêtre, Hubi posé en coin.

### Le problème (court)
- Titre : **Dix fenêtres pour un seul projet ?**
- Texte : Un front, un back, des side-projects. Chacun son IDE, sa base de
  données, ses variables d'environnement, sa commande de lancement, sa session
  Claude. Tu passes ta journée à jongler. Dev Hub met tout au même endroit.

### Fonctionnalités (grille de cartes, icône + titre + 1–2 lignes)
1. **Onglets comme l'Explorateur** — Chaque onglet est un Dev Hub complet :
   un projet par onglet, glisser pour réordonner, `Ctrl` `T` / `Ctrl` `W`. Tout
   est restauré au redémarrage.
2. **Projets et groupes** — Ajoute tes repos un par un ou scanne un dossier
   entier. Regroupe front et back, lance tout un groupe d'un clic.
3. **Git sans quitter l'app** — Statut en direct, pull, push, commit,
   branches, fusion, historique, résolution de conflits côte à côte.
4. **Messages de commit par IA** — Générés depuis ton diff (Conventional
   Commits), avec Claude Code, Codex ou une API (OpenAI, DeepSeek, Anthropic).
5. **Bases de données** — Détection automatique (`.env`, Spring, Prisma,
   docker-compose). PostgreSQL, MySQL, SQLite, MongoDB : parcourir, filtrer,
   éditer comme un tableur, SQL libre.
6. **Lancer tes serveurs** — Commandes par projet, logs colorés en direct,
   aperçu navigateur intégré. Port déjà utilisé ? Dev Hub te dit qui le tient
   (Claude Code, IntelliJ…) et le libère en un clic.
7. **Code** — Explore les fichiers, vois les changements, modifie et
   enregistre (`Ctrl` `S`), aperçu Markdown et HTML.
8. **Sessions IA intégrées** — Claude Code et Codex dans un terminal embarqué,
   historique des sessions par projet, reprise en un clic.
9. **Variables d'environnement** — Tes `.env` édités façon Vercel, valeurs
   masquées.
10. **Ton IDE en un clic** — WebStorm, IntelliJ, PyCharm, VS Code, Rider,
    GoLand… détectés automatiquement, ou un terminal à la racine du projet.
11. **31 thèmes** — Clairs et sombres : Tokyo Night, Dracula, Nord,
    Catppuccin, GitHub, Atom One…
12. **Recherche globale** — `Ctrl` `K` : un fichier ou une branche dans tous
    tes projets à la fois.

### Section Hubi (mise en avant, fond légèrement différent)
- Titre : **Voici Hubi.**
- Sous-titre : Un petit compagnon qui vit sur ton bureau, même Dev Hub fermé.
- Visuel : la grille des 14 humeurs (lien ci-dessus).
- Points :
  - **Il suit ton IA** — Il travaille avec sa tablette pendant que Claude
    Code ou Codex bosse, affiche combien de sessions tournent (« ● 2 Claude »),
    et lève la main quand une session attend ta réponse.
  - **Il te prévient** — Session terminée, erreur, minuteur : une bulle et un
    petit son.
  - **Tes tâches** — `Ctrl` `Alt` `H` de n'importe où pour noter une tâche
    (`@projet` pour la ranger), puis lance-la dans une session Claude ou Codex.
  - **Il a de la personnalité** — Il s'endort quand tu ne fais rien, rit quand
    tu cliques dessus, suit ton curseur des yeux.
  - **Discret** — Version clair, graphite ou auto, mode « mascotte seule »
    sans cadre, présent sur tous tes bureaux virtuels.

### Comment ça marche (3 étapes)
1. **Télécharge** `DevHub.exe` — rien à installer, un seul fichier.
2. **Ajoute tes projets** — un dossier à la fois ou scanne tout ton dossier de
   travail.
3. **Travaille** — ouvre ton IDE, lance tes serveurs, parle à ton IA ; Hubi
   veille.

### Plateformes
- **Windows 10 / 11** — Disponible (bouton télécharger)
- **macOS** — Bientôt
- **Linux** — Bientôt (une première version expérimentale existe déjà dans le
  code)
- Texte : Suis le projet sur GitHub (⭐ / Watch → Releases) pour être prévenu.

### FAQ
- **C'est gratuit ?** Oui, gratuit et en usage libre ; le code est sur GitHub.
- **Faut-il un compte ?** Non. Aucune inscription, aucun serveur : tout reste
  sur ta machine (`%LOCALAPPDATA%\DevHub`).
- **Windows affiche « Windows a protégé votre ordinateur » ?** L'exe n'est pas
  encore signé : clique sur *Informations complémentaires* puis *Exécuter
  quand même*.
- **Il me faut quoi ?** Windows 10 ou 11 (64 bits) et Git. Pour les fonctions
  IA : Claude Code ou Codex installés, ou une clé d'API pour les messages de
  commit.
- **Mes identifiants GitHub / GitLab ?** Dev Hub ne les demande ni ne les
  stocke : il s'appuie sur ton git et tes CLI déjà connectés.
- **Et macOS / Linux ?** En préparation. Suis les releases sur GitHub.
- **Comment mettre à jour ?** Télécharge la nouvelle version depuis ce site ou
  la page des releases et remplace l'ancien exe.

### Appel final
- Titre : **Prêt à fermer quelques fenêtres ?**
- Bouton : **Télécharger Dev Hub pour Windows**
- Mention : *v0.6.0 · gratuit · macOS et Linux bientôt*

### Footer
- Colonne 1 : logo Dev Hub + « Tous tes projets. Une seule fenêtre. »
- Colonne 2 — Produit : Fonctionnalités · Hubi · Télécharger · Nouveautés
  (changelog)
- Colonne 3 — Ressources : GitHub · Releases · Signaler un bug (Issues :
  https://github.com/salifbiaye/dev-hub/issues)
- Colonne 4 — Plateformes : Windows (disponible) · macOS (bientôt) · Linux
  (bientôt)
- Bas de page : « © 2026 Salif Biaye · Dev Hub est gratuit et en usage libre »
  · Hubi (petite icône) qui fait coucou.

## 6. SEO

- Titre : *Dev Hub — tous tes projets de dev dans une seule fenêtre*
- Description : *App de bureau gratuite pour développeurs : git, IDE, bases de
  données, serveurs de dev et sessions Claude Code / Codex réunis. Avec Hubi,
  le compagnon qui te prévient quand ton IA a fini. Windows, macOS et Linux
  bientôt.*
- Mots-clés naturels dans les textes : outil développeur Windows, gestion de
  projets git, Claude Code, Codex, base de données, serveur de dev.
- Open Graph : image 1200×630 (fond `#0a0a0c`, logo, titre du hero, Hubi).
- Favicon : logo Dev Hub.
- Données structurées `SoftwareApplication` (nom, système Windows, prix 0,
  lien de téléchargement).

## 7. Ce qu'il ne faut pas écrire

- Pas de chiffres inventés (utilisateurs, étoiles, avis).
- Pas de « macOS disponible » : macOS et Linux sont **bientôt**.
- Pas de formulaire qui demande un mot de passe ou un compte.

## 8. Prompt à coller dans le générateur

> Crée un site vitrine une page (landing page), en français, pour **Dev Hub**,
> une application de bureau gratuite pour développeurs (Windows, macOS et Linux
> bientôt) qui réunit dans une seule fenêtre les projets git, les IDE, les
> bases de données, les variables d'environnement, les serveurs de dev et les
> sessions IA (Claude Code, Codex). Elle inclut **Hubi**, un petit compagnon de
> bureau (corps blanc arrondi, deux yeux ovales) qui suit les sessions IA et
> prévient quand elles ont fini ou attendent une réponse.
>
> Style : sombre, sobre et moderne façon Linear/Raycast. Fond `#0a0a0c`,
> surfaces `#111114`, bordures `#232327`, texte `#ededf0`, texte secondaire
> `#8b8b93`, accent violet `#6e56cf`. Polices Inter et JetBrains Mono.
> Animations discrètes au scroll, raccourcis clavier affichés comme des
> touches. Responsive.
>
> Sections dans l'ordre : navigation (Fonctionnalités, Hubi, FAQ, GitHub,
> bouton Télécharger) ; hero « Tous tes projets. Une seule fenêtre. » avec
> bouton **Télécharger pour Windows** (lien
> https://github.com/salifbiaye/dev-hub/releases/latest/download/DevHub.exe,
> v0.6.0, 33 Mo), bouton secondaire GitHub
> (https://github.com/salifbiaye/dev-hub) et mention « macOS et Linux :
> bientôt · Gratuit », avec une vidéo de l'app dans un cadre de fenêtre ;
> section problème « Dix fenêtres pour un seul projet ? » ; grille de 12
> fonctionnalités (onglets façon Explorateur, projets et groupes, git intégré,
> messages de commit par IA, bases de données PostgreSQL/MySQL/SQLite/MongoDB,
> lancement de serveurs avec détection de port déjà utilisé, onglet Code avec
> édition et aperçu Markdown/HTML, sessions Claude Code et Codex intégrées,
> variables d'environnement, ouverture d'IDE en un clic, 31 thèmes, recherche
> globale Ctrl K) ; section **Hubi** mise en avant avec l'image
> https://raw.githubusercontent.com/salifbiaye/dev-hub/main/docs/mascot/humeurs.png
> (ses 14 humeurs) et 5 points (il suit ton IA, il te prévient, tes tâches via
> Ctrl Alt H, il a de la personnalité, discret) ; « Comment ça marche » en 3
> étapes (télécharger, ajouter ses projets, travailler) ; plateformes
> (Windows disponible, macOS bientôt, Linux bientôt) ; FAQ (gratuit, pas de
> compte et tout reste en local, avertissement SmartScreen car l'exe n'est pas
> signé : « Informations complémentaires » puis « Exécuter quand même »,
> prérequis Windows 10/11 64 bits et Git, identifiants git jamais demandés,
> macOS/Linux en préparation, mise à jour en remplaçant l'exe) ; appel final
> « Prêt à fermer quelques fenêtres ? » ; footer 4 colonnes (marque, Produit,
> Ressources avec GitHub/Releases/Issues, Plateformes) et « © 2026 Salif Biaye
> · gratuit et en usage libre ».
>
> Logo : https://raw.githubusercontent.com/salifbiaye/dev-hub/main/backend/icon.png
> — Icône de Hubi :
> https://raw.githubusercontent.com/salifbiaye/dev-hub/main/frontend/public/hubi/hubi-icon.png
> N'invente aucun chiffre (utilisateurs, étoiles, avis). Ajoute les balises SEO
> et Open Graph.

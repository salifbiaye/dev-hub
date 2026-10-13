# Hubi : suivre l'utilisateur d'un bureau virtuel à l'autre, et pouvoir le fermer / rouvrir

Statut : **à faire** (note de conception, rien n'est encore codé).
Branche : `feat/hubi-mascotte`.

## Le problème

Sous Windows, une fenêtre n'existe que sur **un** bureau virtuel (Win + Ctrl + flèches).
Hubi est créé sur le bureau où DevHub a été lancé : quand on change de bureau,
la mascotte reste sur l'ancien et on ne la voit plus. Or Hubi est justement fait
pour être toujours là, dans un coin de l'écran, quel que soit le bureau.

À côté de ça, on veut pouvoir **fermer** Hubi quand il gêne, et le **rouvrir**
facilement, sans quitter DevHub.

## Ce qu'on veut

1. **Hubi visible sur tous les bureaux** : on change de bureau, il est toujours
   là, à la même place, sans clignotement notable.
2. **Fermer / rouvrir** sans passer par un fichier de config :
   - fermer = Hubi disparaît, mais DevHub et l'icône de la zone de notification
     restent ; rouvrir le ramène là où il était ;
   - l'état (visible ou fermé) est mémorisé d'une session à l'autre.
3. Les deux sont **réglables** : une case « Visible sur tous les bureaux »
   (activée par défaut) pour ceux qui préfèrent le garder sur un seul bureau.

## Menu et accès

| Où | Quoi |
|---|---|
| Icône de la zone de notification | **Fermer Hubi / Rouvrir Hubi** (un seul élément qui change de libellé), **Visible sur tous les bureaux** (case à cocher). La zone de notification est commune à tous les bureaux : l'icône reste donc atteignable partout. |
| Clic droit sur la mascotte | Petit menu : Fermer, Taille, Mascotte, Visible sur tous les bureaux. Aujourd'hui `contextmenu` est bloqué dans `frontend/public/hubi/app.js` : à remplacer par ce menu. |
| Raccourci global (optionnel) | Un raccourci pour afficher / masquer Hubi, utile quand on ne voit plus la mascotte ni la zone de notification (ex. `Ctrl+Alt+H`). À valider : ne pas entrer en conflit avec d'autres raccourcis. |
| Réglages de DevHub | Un interrupteur Hubi (déjà prévu : `hubi_set_enabled` existe côté API, il manque l'écran dans l'UI). |

Aujourd'hui l'élément « Afficher / masquer les yeux » du menu de l'icône fait déjà
presque ça ; il est à renommer (« Fermer Hubi » / « Rouvrir Hubi ») et à compléter
par le clic droit.

## Approche technique

### Windows (priorité)

Deux pistes, de la plus sûre à la plus fragile :

1. **API documentée `IVirtualDesktopManager`** (COM, stable depuis Windows 10) :
   - `IsWindowOnCurrentVirtualDesktop(hwnd)` : savoir si Hubi est sur le bureau courant ;
   - `GetWindowDesktopId(hwnd_d_une_autre_fenetre)` : récupérer l'identifiant du
     bureau courant à partir d'une fenêtre qui s'y trouve (par exemple la fenêtre
     au premier plan) ;
   - `MoveWindowToDesktop(hwnd_de_hubi, id)` : ramener Hubi sur ce bureau.
   - Hubi appartient à notre processus, donc `MoveWindowToDesktop` est autorisé.
   - On vérifie périodiquement (toutes les 300 à 500 ms, dans le `poll()` déjà
     existant côté `HubiApi`) et on déplace Hubi quand `IsWindowOnCurrentVirtualDesktop`
     passe à faux.
   - Limite : un délai de quelques centaines de ms avant que la mascotte
     réapparaisse après le changement de bureau.
2. **« Épingler » la fenêtre (visible sur tous les bureaux)** via les interfaces
   non documentées (`IVirtualDesktopPinnedApps`, ou une bibliothèque comme
   `pyvda` / `VirtualDesktopAccessor`). Plus propre (pas de délai) mais les GUID
   changent selon les builds de Windows 10/11 : à n'utiliser qu'avec un repli
   sur la piste 1 si l'épinglage échoue.

À ajouter dans la couche plateforme, comme le reste (`core/platform/*/overlay.py`),
par exemple une méthode `overlay_set_all_desktops(win, enabled)`, et un appel
régulier depuis `HubiApi.poll()` pour la piste 1.

### Linux (best-effort, jamais testé)

GTK : `Gtk.Window.stick()` met la fenêtre sur tous les espaces de travail ;
`set_keep_above(True)` est déjà appliqué. À faire dans `_on_gtk_thread`, comme
les autres appels GTK.

### macOS

Non commencé. L'équivalent est `NSWindowCollectionBehaviorCanJoinAllSpaces`.

## Configuration

Dans la section `hubi` de `config.json` :

- `visible` (existe déjà) : Hubi ouvert ou fermé, mémorisé ;
- `all_desktops` (nouveau, défaut `true`) : suivre l'utilisateur sur tous les bureaux.

## Points à vérifier sur un vrai PC

- Le délai d'apparition après un changement de bureau (piste 1) : acceptable ou gênant ?
- Un bureau où une application plein écran tourne : Hubi doit rester visible
  (le `HWND_TOPMOST` réaffirmé toutes les 2 s existe déjà).
- Plusieurs écrans : sur quel écran Hubi doit-il rester ? (aujourd'hui : l'écran
  où il a été déposé en dernier ; la position est mémorisée.)
- Que fait Hubi si `IVirtualDesktopManager` n'est pas disponible (Windows sans
  bureaux virtuels, Windows Server) : ne rien faire, sans erreur.
- Le menu de la zone de notification fonctionne-t-il bien depuis n'importe quel
  bureau ?

## Critères d'acceptation

- Je change de bureau avec Win + Ctrl + flèches : la mascotte est visible sur
  chaque bureau, au même endroit de l'écran, en moins d'une demi-seconde.
- « Fermer Hubi » le fait disparaître ; « Rouvrir Hubi » le ramène, y compris
  après un redémarrage de DevHub.
- Décocher « Visible sur tous les bureaux » le laisse sur un seul bureau.
- Aucune erreur dans la console si les bureaux virtuels ne sont pas disponibles.

## Ordre de travail proposé

1. Renommer l'élément de menu et le faire basculer entre « Fermer » et « Rouvrir ».
2. Case « Visible sur tous les bureaux » + clé `all_desktops`.
3. Piste 1 (documentée) sous Windows, dans `overlay.py` et `HubiApi.poll()`.
4. Menu du clic droit sur la mascotte.
5. Épinglage non documenté (piste 2) si le délai de la piste 1 gêne.
6. Raccourci global, si besoin.

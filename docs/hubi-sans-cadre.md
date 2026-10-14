# Hubi : mascotte seule, sans cadre noir

Statut : **fait** (2026-10-14) — option « Mascotte seule, sans cadre » de la page Hubi. Implémenté par la piste ci-dessous : `core/platform/windows/composition_window.py`. L'hébergement pywebview reste utilisé pour le mode avec cadre (et en secours).

## Ce qu'on veut

Une option « mascotte seule » : plus de panneau noir, Hubi flotte directement
sur le bureau, et les clics à côté de lui passent aux fenêtres en dessous.

## Ce qui ne marche pas (fenêtre pywebview / WinForms + contrôle WebView2)

| Technique | Résultat |
|---|---|
| `TransparencyKey` (couleur clé, `WS_EX_LAYERED`) | WebView2 n'est pas concerné : rectangle gris, et toute la fenêtre devient « traversable » aux clics |
| `DwmExtendFrameIntoClientArea(-1)` + fond WebView2 transparent | Windows 11 peint un gris uni, pas le bureau |
| `DwmEnableBlurBehindWindow` (région vide, astuce de tao/Tauri) | Pas de transparence visible |
| `SetWindowRegion` | Limite bien les **clics** à la mascotte, mais ne découpe pas l'**affichage** de WebView2 |

À savoir : `DefaultBackgroundColor = Transparent` posé après la création de
WebView2 n'a aucun effet ; il faut la variable
`WEBVIEW2_DEFAULT_BACKGROUND_COLOR=0` avant le démarrage.

## Ce qui marche (implémenté)

Héberger WebView2 en mode **composition** (comme Electron) :

- fenêtre créée avec `WS_EX_NOREDIRECTIONBITMAP` ;
- `CoreWebView2Environment.CreateCoreWebView2CompositionControllerAsync(hwnd)` ;
- un `IDCompositionDevice` / `IDCompositionTarget` (CreateTargetForHwnd) /
  `IDCompositionVisual` (COM via ctypes), passé à `RootVisualTarget` ;
- fond WebView2 transparent : les pixels transparents de la page laissent voir
  le bureau, avec l'alpha (ombres douces comprises) ;
- clics : `SetWindowRgn` aux zones dessinées (le code d'essai savait déjà
  envoyer ces zones depuis la page) **et** renvoi manuel de la souris au
  contrôleur (`SendMouseInput`) : en mode composition WebView2 ne reçoit plus
  les messages souris tout seul.

Le lien page ↔ Python passe par les messages de WebView2
(`chrome.webview.postMessage` / `WebMessageReceived`), exposés à la page sous
la même forme `window.pywebview.api` : le code de la page est le même dans les
deux modes. Changer de mode redémarre Hubi.

/* Hubi — comportement : sommeil, curiosité, clic, glisser, humeurs forcées.
 *
 * Le pont Python (window.pywebview.api) fournit la position du curseur et
 * l'inactivité globales ; sans pont (aperçu dans un navigateur), le curseur
 * est pris sur la page et rien ne dort.
 */
;(function () {
  'use strict'

  const SLEEPY_AFTER = 60 // s sans activité clavier/souris
  const ASLEEP_AFTER = 66 // 6 s après « somnolent »
  const EXCITED_DISTANCE = 160 // px logiques entre le curseur et le widget
  const CLICK_MOVE_MAX = 4 // px : en dessous, c'est un clic, pas un glisser
  const POLL_MS = 33

  const canvas = document.getElementById('c')
  const eyes = HubiEyes.createEyes(canvas)

  let base = 'normal' // humeur persistante (forcée depuis le menu ou plus tard par les sessions)
  let overlay = null // { name, until } : humeur temporaire
  let idle = 0
  let sleeping = false
  let cursor = null // { x, y } relatifs au centre du widget, en px logiques
  let lastReported = ''
  let current = 'normal'
  let theme = null // thème Dev Hub suivi (null = cyan d'origine)
  let themeMap = null
  let mascot = 'light' // light | graphite | auto

  // Bulle : « collante » (question en attente, minuteur fini) tant qu'on ne
  // clique pas, ou temporaire ; la temporaire passe devant.
  let sticky = null // { text, tone }
  let transient = null // { text, tone, until }
  let bubbleAlpha = 0
  let timer = null // { end, label } (end en ms epoch)
  let openTasks = 0
  let sessions = {} // sessions IA en cours par outil : { claude: 2, codex: 1 }

  function api() {
    return window.pywebview && window.pywebview.api ? window.pywebview.api : null
  }

  // ------------------------------------------------------------ humeurs

  function setMood(name, ms) {
    if (!HubiEyes.MOOD_NAMES.includes(name)) return
    const duration = ms !== undefined && ms !== null ? ms : HubiEyes.TRANSIENT_MS[name]
    if (duration) {
      overlay = { name, until: performance.now() + duration }
    } else {
      overlay = null
      base = name
    }
  }

  function derivedMood() {
    const now = performance.now()
    if (overlay) {
      if (now < overlay.until) return overlay.name
      overlay = null
    }
    if (base !== 'normal') return base
    if (sleeping) return idle >= ASLEEP_AFTER ? 'asleep' : 'sleepy'
    if (cursor) {
      const halfW = window.innerWidth / 2
      const halfH = window.innerHeight / 2
      const dx = Math.max(Math.abs(cursor.x) - halfW, 0)
      const dy = Math.max(Math.abs(cursor.y) - halfH, 0)
      if (Math.hypot(dx, dy) < EXCITED_DISTANCE) return 'excited'
    }
    return 'normal'
  }

  function updateSleep() {
    const shouldSleep = base === 'normal' && idle >= SLEEPY_AFTER
    if (sleeping && !shouldSleep && idle < SLEEPY_AFTER) {
      // Réveil en sursaut.
      sleeping = false
      setMood('startle')
    } else {
      sleeping = shouldSleep
    }
  }

  // ------------------------------------------------------------ couleur du thème

  function hexToRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return null
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  async function applyTheme(name) {
    theme = name
    if (!name) {
      eyes.setBaseColor(null)
      return
    }
    if (!themeMap) {
      try {
        themeMap = await (await fetch('hubi/themes.json')).json()
      } catch (e) {
        themeMap = {}
      }
    }
    if (theme === name) eyes.setBaseColor(hexToRgb(themeMap[name]))
  }

  // ------------------------------------------------------------ boucle de rendu

  let lastFrame = performance.now()
  let frames = 0 // images dessinées : Python recharge la page si ça n'avance plus

  // Mode « mascotte seule » : la fenêtre n'accepte les clics que là où Hubi
  // dessine. Les zones (unités du canevas) partent avec le prochain poll,
  // seulement quand elles changent (arrondies à 4 px près).
  // Fenêtre transparente : dès le chargement (pas de flash du panneau noir).
  let frameless = new URLSearchParams(location.search).has('frameless')
  if (frameless) eyes.setFrameless(true)
  let hitsKey = ''
  let pendingHits = null
  function noteHits(rects) {
    const rounded = rects.map((r) => r.map((v) => Math.round(v / 4) * 4))
    const key = JSON.stringify(rounded)
    if (key === hitsKey) return
    hitsKey = key
    pendingHits = rounded
  }

  function frame(now) {
    frames++
    const dt = (now - lastFrame) / 1000
    lastFrame = now

    updateSleep()
    const mood = derivedMood()
    if (mood !== current) {
      current = mood
      eyes.setMood(mood)
    }
    if (mood !== lastReported) {
      lastReported = mood
      const a = api()
      if (a) a.report_mood(mood)
    }

    if (cursor) {
      // Le regard suit la direction du curseur, sans dépendre de la taille de l'écran.
      eyes.setLook(cursor.x / 300, cursor.y / 200)
    } else {
      eyes.setLook(0, 0)
    }
    eyes.step(dt)
    eyes.render()
    drawHud(dt)
    requestAnimationFrame(frame)
  }

  // ------------------------------------------------------------ bulle et badges

  function currentBubble() {
    if (transient && performance.now() >= transient.until) transient = null
    return transient || sticky
  }

  let lastBubble = null
  function drawHud(dt) {
    const ctx = canvas.getContext('2d')
    const accent = eyes.getBaseColor()
    const bubble = currentBubble()
    if (bubble) lastBubble = bubble
    const k = 1 - Math.exp(-dt * 12)
    bubbleAlpha += ((bubble ? 1 : 0) - bubbleAlpha) * k
    eyes.setSqueeze(!!bubble)
    const hits = [eyes.bodyRect()]
    if (bubbleAlpha > 0.02 && lastBubble) {
      HubiHud.drawBubble(ctx, lastBubble.text, lastBubble.tone, accent, bubbleAlpha)
      if (bubbleAlpha > 0.3) hits.push(HubiHud.BUBBLE_RECT)
    }
    if (timer) {
      const left = timer.end - Date.now()
      const color = left < 60000 ? HubiHud.TONES.warn : accent
      hits.push(HubiHud.drawBadge(ctx, HubiHud.formatRemaining(left), false, color))
    }
    if (openTasks > 0) {
      hits.push(HubiHud.drawBadge(ctx, String(openTasks), true, accent, 'check'))
    }
    const sessionsRect = HubiHud.drawSessions(ctx, sessions, timer ? 44 : 6)
    if (sessionsRect) hits.push(sessionsRect)
    if (frameless) noteHits(hits)
  }

  function bubbleVisible() {
    return !!currentBubble()
  }

  function handleCommand(cmd) {
    switch (cmd[0]) {
      case 'mood':
        setMood(cmd[1], cmd[2])
        break
      case 'bubble':
        transient = cmd[1] ? { text: cmd[1], tone: cmd[3] || 'info', until: performance.now() + (cmd[2] || 6000) } : null
        break
      case 'sticky':
        sticky = cmd[1] ? { text: cmd[1], tone: cmd[2] || 'warn' } : null
        break
      case 'timer':
        timer = cmd[1] ? { end: cmd[1], label: cmd[2] || '' } : null
        break
      case 'tasks':
        openTasks = cmd[1] || 0
        break
      case 'sessions':
        sessions = cmd[1] || {}
        break
      case 'beep':
        HubiHud.beep(cmd[1])
        break
    }
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(window.innerWidth * dpr))
    const h = Math.max(1, Math.round(window.innerHeight * dpr))
    // Le canvas garde le ratio 400:240 ; la fenêtre est déjà en 5:3.
    canvas.width = w
    canvas.height = Math.round((w * HubiEyes.H) / HubiEyes.W)
  }
  window.addEventListener('resize', resize)
  resize()

  // ------------------------------------------------------------ pont Python

  let polling = false
  async function poll() {
    const a = api()
    if (!a) return
    const started = performance.now()
    try {
      const sendHits = pendingHits
      pendingHits = null
      const res = await a.poll(frames, sendHits)
      if (res) {
        idle = res.idle == null ? 0 : res.idle
        cursor = res.cursor ? { x: res.cursor[0], y: res.cursor[1] } : null
        if (!!res.frameless !== frameless) {
          frameless = !!res.frameless
          eyes.setFrameless(frameless)
          hitsKey = '' // renvoyer les zones cliquables
        }
        if (res.mascot && res.mascot !== mascot) {
          mascot = res.mascot
          eyes.setMascot(mascot)
        }
        const wanted = res.theme || null
        if (wanted !== theme) applyTheme(wanted)
        for (const cmd of res.cmds || []) handleCommand(cmd)
      }
    } catch (e) {
      // Le pont peut disparaître pendant la fermeture : on réessaie plus tard.
    }
    setTimeout(poll, Math.max(0, POLL_MS - (performance.now() - started)))
  }

  function startPolling() {
    if (polling) return
    polling = true
    poll()
  }

  if (api()) {
    startPolling()
  } else {
    window.addEventListener('pywebviewready', startPolling)
    // Aperçu dans un navigateur : le curseur est pris sur la page.
    window.addEventListener('mousemove', function (e) {
      if (api()) return
      cursor = { x: e.clientX - window.innerWidth / 2, y: e.clientY - window.innerHeight / 2 }
    })
  }

  // ------------------------------------------------------------ clic et glisser

  let dragging = false
  let fallback = null // { sx, sy } si le glisser natif n'existe pas

  canvas.addEventListener('pointerdown', async function (e) {
    if (e.button !== 0) return
    HubiHud.unlockAudio()
    dragging = true
    canvas.setPointerCapture(e.pointerId)
    const a = api()
    if (!a) {
      fallback = null
      return
    }
    const res = await a.drag_start()
    fallback = res && res.native === false ? { sx: e.screenX, sy: e.screenY } : null
  })

  canvas.addEventListener('pointermove', function (e) {
    if (!dragging || !fallback) return
    const a = api()
    if (!a) return
    a.move_by(e.screenX - fallback.sx, e.screenY - fallback.sy)
    fallback.sx = e.screenX
    fallback.sy = e.screenY
  })

  async function endPointer() {
    if (!dragging) return
    dragging = false
    const a = api()
    let moved = 0
    if (a) {
      const res = await a.drag_result()
      moved = res && res.moved ? res.moved : 0
    }
    if (moved < CLICK_MOVE_MAX) {
      // Un clic ferme la bulle (et acquitte l'alerte), réveille en sursaut,
      // sinon fait rire.
      if (bubbleVisible()) {
        transient = null
        sticky = null
        if (a) a.dismiss()
      } else if (sleeping) {
        sleeping = false
        setMood('startle')
      } else {
        setMood('laugh')
      }
    }
  }
  canvas.addEventListener('pointerup', endPointer)
  canvas.addEventListener('pointercancel', endPointer)

  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault()
  })

  window.hubi = { setMood, eyes, handleCommand }
  requestAnimationFrame(frame)
})()

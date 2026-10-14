/* Hubi — dessin des yeux (canvas 2D, repère logique 400x240).
 *
 * Aucune image : tout est dessiné en code. Chaque humeur est un jeu de
 * paramètres (PRESETS) ; le rendu interpole tous les paramètres de façon
 * exponentielle, donc les transitions sont toujours fluides.
 */
(function (global) {
  'use strict'

  const W = 400
  const H = 240
  const PANEL_RADIUS = 0 // the window itself is rounded by Windows 11 (see overlay.py)

  const CYAN = [0, 229, 255]
  const AMBER = [255, 193, 7]
  const RED = [255, 82, 82]
  const GREEN = [105, 240, 174]

  // Valeurs par défaut : l'humeur « normal ». Chaque humeur ne surcharge
  // que ce qui change.
  const BASE = {
    cy: 100, // centre vertical des yeux
    sep: 140, // distance entre les centres des deux yeux
    w: 96,
    h: 120,
    r: 36, // rayon des coins
    lid: 0, // part de la hauteur recouverte par la paupière haute (0..1)
    slant: 0, // inclinaison de la paupière (px, positif = sourcils froncés)
    arc: 0, // 0..1 : les deux yeux deviennent des arcs « ^ »
    cross: 0, // 0..1 : croix à la place des yeux
    iris: 0, // 0..1 : iris-circuit
    wink: 0, // 0..1 : l'œil droit devient un arc (clin d'œil)
    ring: 0, // 0..1 : anneau blanc pulsant autour des yeux (alerte sur thème ambré)
    zzz: 0,
    look: 1, // gain du suivi du curseur
    shake: 0, // amplitude de tremblement (px)
    pulse: 0, // amplitude de pulsation (échelle)
    bounce: 0, // amplitude de rebond (px)
    squeeze: 0, // 0..1 : yeux réduits vers le haut pour laisser la place à la bulle
    dim: 0, // 0..1 : le corps passe du blanc au graphite (mascotte « auto » : il dort)
    tablet: 0, // 0..1 : mains + tablette qui montre l'état de la session
    lines: 0, // 0..1 : petits traits d'agitation autour du corps (alerte, sursaut)
    puff: 1, // gonflement du corps (peur, sursaut)
    sink: 0, // px : le corps s'affaisse (somnolent, endormi)
    r_: CYAN[0],
    g_: CYAN[1],
    b_: CYAN[2],
  }

  const PRESETS = {
    normal: {},
    sleepy: { lid: 0.5, cy: 102, look: 0.3, sink: 4, dim: 0.35 },
    asleep: { lid: 0.93, cy: 92, look: 0, zzz: 1, sink: 10, puff: 0.97, dim: 1 },
    startle: { w: 112, h: 156, sep: 148, r: 40, cy: 100, puff: 1.04, lines: 1 },
    excited: { w: 106, h: 134, sep: 150, cy: 102, r: 38, bounce: 5 },
    laugh: { arc: 1, cy: 68, bounce: 6, look: 0 },
    focused: { h: 112, cy: 108, lid: 0.27, slant: 38, look: 0.5 },
    acting: { w: 112, h: 119, sep: 156, cy: 104, r: 38, iris: 1, lid: 0, slant: 0, look: 0.4, tablet: 1 },
    fear: { w: 46, h: 60, sep: 132, cy: 99, r: 14, shake: 3, look: 0.4, puff: 1.06 },
    error: { cross: 1, cy: 100, r_: RED[0], g_: RED[1], b_: RED[2], look: 0 },
    listening: { h: 100, cy: 76, look: 0.4, tablet: 1 },
    understood: { h: 104, cy: 74, wink: 1, look: 0, tablet: 1 },
    alert: { w: 110, h: 140, sep: 152, cy: 101, r: 38, pulse: 0.05, shake: 1.4, r_: AMBER[0], g_: AMBER[1], b_: AMBER[2], puff: 1.04, tablet: 1, lines: 1 },
    happy: { arc: 1, cy: 84, r_: GREEN[0], g_: GREEN[1], b_: GREEN[2], look: 0, tablet: 1 },
  }

  const MOOD_NAMES = Object.keys(PRESETS)

  // Humeurs qui reviennent seules à l'état de base au bout de N ms.
  const TRANSIENT_MS = {
    startle: 800,
    excited: 3000,
    laugh: 1900,
    fear: 2600,
    error: 3000,
    understood: 2400,
    happy: 3200,
  }

  function hueOf(c) {
    const r = c[0] / 255
    const g = c[1] / 255
    const b = c[2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    if (d === 0) return { h: 0, s: 0 }
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h = (h * 60 + 360) % 360
    return { h, s: d / (max === 0 ? 1 : max) }
  }

  // Teinte voisine (à ±32°) d'une couleur de référence ; un accent presque
  // gris ne ressemble à aucune couleur de sens.
  function hueClose(rgb, ref) {
    const a = hueOf(rgb)
    if (a.s < 0.35) return false
    const diff = Math.abs(a.h - hueOf(ref).h)
    return Math.min(diff, 360 - diff) < 32
  }

  // Les yeux sont toujours sur fond noir : un accent trop sombre (thèmes
  // comme « webstorm ») est éclairci jusqu'à une luminance lisible.
  function ensureReadable(rgb) {
    const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
    let c = rgb.slice()
    for (let i = 0; i < 20 && lum(c) < 0.45; i++) {
      c = c.map((v) => v + (255 - v) * 0.12)
    }
    return c.map(Math.round)
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r)
    ctx.lineTo(x + w, y + h - r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
    ctx.lineTo(x + r, y + h)
    ctx.arcTo(x, y + h, x, y + h - r, r)
    ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r)
    ctx.closePath()
  }

  function createEyes(canvas) {
    const ctx = canvas.getContext('2d')
    const params = Object.assign({}, BASE)
    let target = Object.assign({}, BASE)

    let t = 0 // temps écoulé (s)
    let lookX = 0
    let lookY = 0
    let lookTX = 0
    let lookTY = 0

    // Clignement irrégulier : 2,2–6 s, 190 ms, parfois double.
    let blinkAt = 2.5
    let blinkStart = -1
    let doubleBlink = false
    let blinkValue = 0

    // Texte du minuteur etc. viendront plus tard ; ici seulement les yeux.

    // Couleur « de base » (accent du thème Dev Hub) ; les humeurs qui portent
    // un sens (alerte ambre, erreur rouge, content vert) gardent la leur.
    let baseColor = CYAN
    let alertRing = false
    let kind = 'light' // light | graphite | auto (gris quand il dort)
    let moodName = 'normal'
    let squeezeTarget = 0
    let frameless = false

    function setFrameless(on) {
      frameless = !!on
    }

    // Zone occupée par le corps (mains et tablette comprises), en unités du
    // canevas, après la réduction quand une bulle s'affiche : sert de zone
    // cliquable en mode « mascotte seule ».
    function bodyRect() {
      const sq = params.squeeze
      const s = 1 - 0.38 * sq
      const x = W / 2 + (100 - W / 2) * s
      const y = 6 * sq + 34 * s
      return [Math.round(x), Math.round(y), Math.round(200 * s), Math.round(186 * s), Math.round(56 * s)]
    }

    function setMood(name) {
      moodName = PRESETS[name] ? name : 'normal'
      const tint = { r_: baseColor[0], g_: baseColor[1], b_: baseColor[2] }
      target = Object.assign({}, BASE, tint, PRESETS[moodName])
      if (moodName === 'alert' && alertRing) target.ring = 1
      target.squeeze = squeezeTarget
    }

    function setSqueeze(on) {
      squeezeTarget = on ? 1 : 0
      target.squeeze = squeezeTarget
    }

    function getBaseColor() {
      return baseColor
    }

    function setMascot(name) {
      kind = ['light', 'graphite', 'auto'].includes(name) ? name : 'light'
      setMood(moodName)
    }

    function setBaseColor(rgb) {
      baseColor = ensureReadable(rgb || CYAN)
      // Erreur (croix) et content (arcs) se reconnaissent à leur forme, mais
      // l'alerte n'est qu'un œil agrandi : si l'accent du thème est lui-même
      // ambré (gruvbox, amber, halloween…), elle gagne un anneau blanc.
      alertRing = !!rgb && hueClose(rgb, AMBER)
      setMood(moodName)
    }

    function setLook(nx, ny) {
      lookTX = clamp(nx, -1, 1)
      lookTY = clamp(ny, -1, 1)
    }

    function snap() {
      Object.assign(params, target)
    }

    function updateBlink() {
      if (blinkStart < 0) {
        if (t >= blinkAt) {
          blinkStart = t
          doubleBlink = Math.random() < 0.2
        }
        blinkValue = 0
        return
      }
      const DUR = 0.19
      let k = (t - blinkStart) / DUR
      if (doubleBlink) {
        // Deux clignements rapprochés dans la même fenêtre de temps.
        k = k / 2.1
        const phase = k * 2
        blinkValue = phase < 1 ? Math.sin(phase * Math.PI) : phase < 1.15 ? 0 : phase < 2.15 ? Math.sin((phase - 1.15) * Math.PI) : 0
        if (phase >= 2.15) finishBlink()
      } else if (k >= 1) {
        blinkValue = 0
        finishBlink()
      } else {
        blinkValue = Math.sin(k * Math.PI)
      }
    }

    function finishBlink() {
      blinkStart = -1
      blinkAt = t + 2.2 + Math.random() * 3.8
    }

    function step(dt) {
      dt = Math.min(dt, 0.1)
      t += dt
      const k = 1 - Math.exp(-dt * 11)
      for (const key in params) {
        params[key] += (target[key] - params[key]) * k
      }
      const kl = 1 - Math.exp(-dt * 14)
      lookX += (lookTX - lookX) * kl
      lookY += (lookTY - lookY) * kl
      updateBlink()
    }

    // ---------------------------------------------------------------- dessin

    function colorStr(a) {
      return 'rgba(' + Math.round(params.r_) + ',' + Math.round(params.g_) + ',' + Math.round(params.b_) + ',' + a + ')'
    }

    function drawZzz() {
      const a = params.zzz
      if (a < 0.01) return
      ctx.save()
      ctx.fillStyle = colorStr(1)
      ctx.font = 'bold 28px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const zs = [
        { x: 294, y: 92, s: 14, ph: 0 },
        { x: 320, y: 70, s: 22, ph: 0.8 },
        { x: 342, y: 52, s: 30, ph: 1.6 },
      ]
      for (const z of zs) {
        const cycle = (t * 0.45 + z.ph * 0.15) % 1
        const rise = cycle * 14
        const fade = Math.sin(cycle * Math.PI)
        ctx.globalAlpha = a * (0.35 + 0.65 * fade)
        ctx.font = 'bold ' + z.s + 'px sans-serif'
        ctx.fillText('z', z.x + Math.sin(t + z.ph) * 2, z.y - rise)
      }
      ctx.restore()
    }

    // Style sobre : silhouettes sombres sans contour, légèrement plus claires
    // que le cadre noir, avec un liseré de lumière sur le dessus ; seuls les
    // yeux brillent vraiment.

    // ---------------------------------------------------------------- Hubi (corps doux)
    // Un corps arrondi neutre, deux ovales pour yeux, et — seulement quand
    // elles servent — des mains qui tiennent une tablette montrant l'état de
    // la session. La couleur du thème n'apparaît que sur la tablette.

    const SKIN_LIGHT = { b0: [255, 255, 255], b1: [212, 212, 224], ink: [28, 26, 38], hi: 0.9 }
    const SKIN_GRAPHITE = { b0: [82, 82, 96], b1: [40, 40, 48], ink: [241, 241, 247], hi: 0.14 }

    function mixRgb(a, b, k) {
      return a.map((v, i) => v + (b[i] - v) * k)
    }

    function blobPalette() {
      // « auto » : blanc éveillé, gris quand il somnole ou dort (params.dim).
      const d = kind === 'graphite' ? 1 : kind === 'auto' ? clamp(params.dim, 0, 1) : 0
      return {
        b0: mixRgb(SKIN_LIGHT.b0, SKIN_GRAPHITE.b0, d),
        b1: mixRgb(SKIN_LIGHT.b1, SKIN_GRAPHITE.b1, d),
        // Les yeux basculent d'un coup (sombre -> clair) au milieu de la
        // transition : un mélange linéaire passerait par un gris identique
        // à celui du corps et les yeux disparaîtraient.
        ink: mixRgb(SKIN_LIGHT.ink, SKIN_GRAPHITE.ink, clamp((d - 0.45) / 0.1, 0, 1)),
        hi: SKIN_LIGHT.hi + (SKIN_GRAPHITE.hi - SKIN_LIGHT.hi) * d,
      }
    }

    function rgbaOf(c, a) {
      return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a === undefined ? 1 : a) + ')'
    }

    function drawBlobEye(side, ex, ey, ew, eh, pal) {
      const p = params
      const arcA = clamp(Math.max(p.arc, side > 0 ? p.wink : 0), 0, 1)
      const closed = clamp((p.lid - 0.4) / 0.1, 0, 1)
      const bodyA = 1 - Math.max(arcA, p.cross, closed)
      const ink = rgbaOf(pal.ink)

      if (bodyA > 0.01) {
        ctx.save()
        ctx.globalAlpha = bodyA
        ctx.fillStyle = ink
        // Concentré : les ovales s'inclinent, coin intérieur plus bas.
        const tilt = clamp(p.slant / 38, 0, 1) * 0.45
        if (tilt > 0.01) {
          ctx.translate(ex, ey)
          ctx.rotate(-side * tilt)
          ctx.translate(-ex, -ey)
        }
        ctx.beginPath()
        ctx.ellipse(ex, ey, ew / 2, eh / 2, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      ctx.save()
      ctx.strokeStyle = ink
      ctx.lineCap = 'round'
      ctx.lineWidth = 6
      if (arcA > 0.01) {
        ctx.globalAlpha = arcA
        ctx.beginPath()
        ctx.moveTo(ex - 12, ey + 6)
        ctx.quadraticCurveTo(ex, ey - 12, ex + 12, ey + 6)
        ctx.stroke()
      }
      if (closed > 0.01) {
        ctx.globalAlpha = closed * (1 - arcA)
        ctx.beginPath()
        ctx.moveTo(ex - 11, ey)
        ctx.quadraticCurveTo(ex, ey + 9, ex + 11, ey)
        ctx.stroke()
      }
      if (p.cross > 0.01) {
        ctx.globalAlpha = p.cross
        ctx.strokeStyle = '#ff5252'
        ctx.beginPath()
        ctx.moveTo(ex - 9, ey - 9)
        ctx.lineTo(ex + 9, ey + 9)
        ctx.moveTo(ex + 9, ey - 9)
        ctx.lineTo(ex - 9, ey + 9)
        ctx.stroke()
      }
      ctx.restore()
    }

    function drawBlobTablet(cx, cy, pal, accent) {
      const a = params.tablet
      if (a < 0.02) return
      ctx.save()
      ctx.globalAlpha = a
      ctx.translate(cx, cy)
      ctx.rotate(-0.07)
      // Tablette.
      ctx.fillStyle = '#1a1b26'
      roundRectPath(ctx, -46, -24, 92, 52, 9)
      ctx.fill()
      ctx.strokeStyle = rgbaOf(accent, 0.85)
      ctx.lineWidth = 2.4
      ctx.stroke()
      // Écran : l'état de la session.
      ctx.save()
      ctx.translate(0, 2)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (moodName === 'listening') {
        ctx.strokeStyle = rgbaOf(accent)
        ctx.lineWidth = 2.6
        for (let i = 0; i < 3; i++) {
          ctx.beginPath()
          ctx.moveTo(-26, -10 + i * 11)
          ctx.lineTo(14 - i * 8, -10 + i * 11)
          ctx.stroke()
        }
      } else if (moodName === 'acting') {
        ctx.strokeStyle = rgbaOf(accent)
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(0, 0, 13, t * 4, t * 4 + 4.3)
        ctx.stroke()
        ctx.fillStyle = rgbaOf(accent)
        ctx.beginPath()
        ctx.arc(0, 0, 3, 0, Math.PI * 2)
        ctx.fill()
      } else if (moodName === 'alert') {
        ctx.fillStyle = '#ffc107'
        ctx.font = 'bold 30px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('!', 0, 0)
      } else {
        // content / compris : une coche.
        ctx.strokeStyle = '#69f0ae'
        ctx.lineWidth = 4.5
        ctx.beginPath()
        ctx.moveTo(-13, 2)
        ctx.lineTo(-3, 12)
        ctx.lineTo(15, -10)
        ctx.stroke()
      }
      ctx.restore()
      // Mains : deux ellipses du même dégradé que le corps.
      for (const side of [-1, 1]) {
        const g = ctx.createLinearGradient(0, -12, 0, 14)
        g.addColorStop(0, rgbaOf(pal.b0))
        g.addColorStop(1, rgbaOf(pal.b1))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.ellipse(side * 46, 12, 19, 13, side * -0.35, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    function drawBlobScene(shakeX, bounceY, bare) {
      const p = params
      const pal = blobPalette()
      const accent = ensureReadable(baseColor)
      // Flottaison discrète ; l'ombre au sol rétrécit quand il saute.
      const rise = Math.sin(t * 1.5) * 2.2 + bounceY
      const bodyY = 112 + rise + p.sink * 0.5

      if (!bare && !frameless) {
        const halo = ctx.createRadialGradient(200, 120, 10, 200, 120, 200)
        halo.addColorStop(0, 'rgba(255,255,255,0.07)')
        halo.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = halo
        ctx.fillRect(0, 0, W, H)
      }
      if (!bare) {
        const lift = clamp(-rise, 0, 20)
        ctx.fillStyle = 'rgba(0,0,0,' + 0.5 * (1 - lift * 0.015) + ')'
        ctx.beginPath()
        ctx.ellipse(200, 214, 56 * (1 - lift * 0.012), 7, 0, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.save()
      ctx.translate(200 + shakeX * 0.6, bodyY)
      ctx.rotate(-0.035)
      const stretch = bounceY < -0.5 ? 1 + -bounceY * 0.012 : 1
      ctx.scale(p.puff / stretch, p.puff * stretch)

      // Corps.
      const g = ctx.createLinearGradient(0, -63, 0, 63)
      g.addColorStop(0, rgbaOf(pal.b0))
      g.addColorStop(1, rgbaOf(pal.b1))
      ctx.fillStyle = g
      roundRectPath(ctx, -88, -63, 176, 126, 60)
      ctx.fill()
      // Reflet doux en haut à gauche.
      const hi = ctx.createRadialGradient(-40, -48, 4, -40, -48, 70)
      hi.addColorStop(0, 'rgba(255,255,255,' + pal.hi + ')')
      hi.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = hi
      ctx.fill()

      // Yeux : deux ovales ; l'expression passe par leur forme.
      const pulse = 1 + (p.pulse > 0.001 ? Math.sin(t * 7) * p.pulse * 0.4 : 0)
      const arcLike = Math.max(p.arc, p.cross)
      const blink = blinkValue * (1 - arcLike) * (1 - clamp((p.lid - 0.4) / 0.1, 0, 1))
      const ew = p.w * 0.16 * pulse
      let eh = p.h * 0.19 * pulse * (1 - 0.9 * blink)
      eh *= 1 - 0.32 * clamp(p.iris, 0, 1) - 0.18 * clamp(p.slant / 38, 0, 1) // acting / concentré : yeux aplatis
      const half = p.sep * 0.243
      const ox = lookX * 5 * p.look + (p.shake > 0.01 ? shakeX : 0)
      const oy = 4 + lookY * 3 * p.look
      drawBlobEye(-1, -half + ox, oy, ew, eh, pal)
      drawBlobEye(1, half + ox, oy, ew, eh, pal)
      ctx.restore()

      drawBlobTablet(200 + shakeX * 0.6, bodyY + 58, pal, accent)

      // Petits traits d'agitation.
      if (p.lines > 0.02) {
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,' + 0.85 * p.lines + ')'
        ctx.lineWidth = 5
        ctx.lineCap = 'round'
        for (const [x1, y1, x2, y2] of [[-104, -60, -88, -46], [-112, -32, -96, -26], [104, -60, 88, -46], [112, -32, 96, -26]]) {
          ctx.beginPath()
          ctx.moveTo(200 + x1, bodyY + y1)
          ctx.lineTo(200 + x2, bodyY + y2)
          ctx.stroke()
        }
        ctx.restore()
      }
      if (!bare) drawZzz()
    }

    function render() {
      const p = params
      const dpr = canvas.width / W
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // Panneau noir aux coins arrondis (sauf mode « mascotte seule » : fond
      // transparent, Windows laisse voir le bureau autour).
      ctx.save()
      if (!frameless) {
        roundRectPath(ctx, 0, 0, W, H, PANEL_RADIUS)
        ctx.fillStyle = '#000'
        ctx.fill()
        ctx.clip()
      }

      if (p.squeeze > 0.001) {
        const s = 1 - 0.38 * p.squeeze
        ctx.translate(W / 2, 6 * p.squeeze)
        ctx.scale(s, s)
        ctx.translate(-W / 2, 0)
      }

      // Effets dynamiques communs.
      const shakeX = p.shake > 0.01 ? (Math.sin(t * 61) + Math.sin(t * 37 + 1)) * 0.5 * p.shake : 0
      const shakeY = p.shake > 0.01 ? (Math.sin(t * 53 + 2) + Math.sin(t * 29)) * 0.5 * p.shake * 0.6 : 0
      const bounceY = p.bounce > 0.01 ? -Math.abs(Math.sin(t * 9)) * p.bounce : 0
      const pulse = 1 + (p.pulse > 0.001 ? Math.sin(t * 7) * p.pulse : 0)

      const lx = lookX * 12 * p.look
      const ly = lookY * 8 * p.look
      const arcLike = Math.max(p.arc, p.cross)
      const blink = blinkValue * (1 - arcLike) * (1 - clamp(p.lid * 1.6, 0, 1))
      const w = p.w * pulse
      const h = p.h * pulse * (1 - 0.9 * blink)

      drawBlobScene(shakeX, bounceY, false)

      ctx.restore()
    }

    // Rendu sans cadre ni ombre, fond transparent : pour exporter la mascotte
    // en image (le corps doux uniquement).
    function renderBare() {
      const dpr = canvas.width / W
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      drawBlobScene(0, 0, true)
    }

    return { setMood, setBaseColor, getBaseColor, setSqueeze, setFrameless, bodyRect, setMascot, setLook, step, render, renderBare, snap, params }
  }

  global.HubiEyes = { createEyes, MOOD_NAMES, TRANSIENT_MS, W, H, hueClose }
})(window)

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
  const PANEL_RADIUS = 30

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
    glow: 22,
    hi: 1, // opacité du reflet
    mouth: 0,
    zzz: 0,
    notepad: 0,
    thumb: 0,
    look: 1, // gain du suivi du curseur
    shake: 0, // amplitude de tremblement (px)
    pulse: 0, // amplitude de pulsation (échelle)
    bounce: 0, // amplitude de rebond (px)
    owl: 1, // 0..1 : corps de hibou autour des yeux (0 = yeux seuls)
    tuft: 0, // px : houppes des oreilles (positif = dressées, négatif = baissées)
    puff: 1, // gonflement des plumes de la tête
    sink: 0, // px : le hibou s'affaisse (somnolent, endormi)
    flap: 0, // 0..1 : agitation des ailes
    spread: 0, // px : ailes écartées (sursaut, alerte)
    r_: CYAN[0],
    g_: CYAN[1],
    b_: CYAN[2],
  }

  const PRESETS = {
    normal: {},
    sleepy: { lid: 0.5, cy: 102, hi: 0.35, look: 0.3, sink: 4, tuft: -4 },
    asleep: { lid: 0.93, cy: 92, hi: 0.2, look: 0, zzz: 1, glow: 14, sink: 10, tuft: -9, puff: 0.97 },
    startle: { w: 112, h: 156, sep: 148, r: 40, cy: 100, glow: 28, tuft: 12, puff: 1.04, spread: 10 },
    excited: { w: 106, h: 134, sep: 150, cy: 102, r: 38, bounce: 5, tuft: 6, flap: 0.5 },
    laugh: { arc: 1, cy: 68, mouth: 1, bounce: 6, look: 0, flap: 1, tuft: 3 },
    focused: { h: 112, cy: 108, lid: 0.27, slant: 38, look: 0.5, tuft: -5 },
    acting: { w: 112, h: 119, sep: 156, cy: 104, r: 38, iris: 1, lid: 0.08, slant: 14, hi: 0, look: 0.4, flap: 0.45 },
    fear: { w: 46, h: 60, sep: 132, cy: 99, r: 14, shake: 3, glow: 14, look: 0.4, puff: 1.06, tuft: -8 },
    error: { cross: 1, cy: 100, r_: RED[0], g_: RED[1], b_: RED[2], look: 0 },
    listening: { h: 100, cy: 76, notepad: 1, look: 0.4, tuft: 3 },
    understood: { h: 104, cy: 74, wink: 1, thumb: 1, look: 0, tuft: 4 },
    alert: { w: 110, h: 140, sep: 152, cy: 101, r: 38, pulse: 0.05, shake: 1.4, r_: AMBER[0], g_: AMBER[1], b_: AMBER[2], glow: 28, tuft: 14, puff: 1.04, spread: 6 },
    happy: { arc: 1, cy: 84, r_: GREEN[0], g_: GREEN[1], b_: GREEN[2], look: 0, flap: 0.8, tuft: 4 },
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
    let mascotOwl = true
    let moodName = 'normal'

    function setMood(name) {
      moodName = PRESETS[name] ? name : 'normal'
      const tint = { r_: baseColor[0], g_: baseColor[1], b_: baseColor[2] }
      target = Object.assign({}, BASE, tint, PRESETS[moodName])
      if (moodName === 'alert' && alertRing) target.ring = 1
      target.owl = mascotOwl ? 1 : 0
    }

    function setMascot(name) {
      mascotOwl = name !== 'eyes'
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

    function drawArc(x, y, alpha, lineW) {
      // Arc « ^ » : deux extrémités basses, sommet haut.
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.lineWidth = lineW
      ctx.lineCap = 'round'
      ctx.strokeStyle = colorStr(1)
      ctx.shadowColor = colorStr(0.9)
      ctx.shadowBlur = params.glow * 0.7
      ctx.beginPath()
      ctx.moveTo(x - 31, y + 9)
      ctx.quadraticCurveTo(x, y - 27, x + 31, y + 9)
      ctx.stroke()
      ctx.restore()
    }

    function drawCross(x, y, alpha) {
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.lineWidth = 11
      ctx.lineCap = 'round'
      ctx.strokeStyle = colorStr(1)
      ctx.shadowColor = colorStr(0.8)
      ctx.shadowBlur = 16
      ctx.beginPath()
      ctx.moveTo(x - 36, y - 36)
      ctx.lineTo(x + 36, y + 36)
      ctx.moveTo(x + 36, y - 36)
      ctx.lineTo(x - 36, y + 36)
      ctx.stroke()
      ctx.restore()
    }

    function drawIris(x, y, alpha) {
      ctx.save()
      ctx.globalAlpha = alpha
      // Iris sombre.
      ctx.fillStyle = '#04121a'
      ctx.beginPath()
      ctx.arc(x, y, 51, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = colorStr(1)
      ctx.lineCap = 'round'

      // Anneau extérieur en pointillés, sens horaire.
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(t * 0.9)
      ctx.lineWidth = 2.6
      ctx.setLineDash([9, 6])
      ctx.beginPath()
      ctx.arc(0, 0, 44, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      // Anneau intérieur, sens inverse et plus vite.
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(-t * 2.1)
      ctx.lineWidth = 2.2
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.arc(0, 0, 29, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      // Trois pistes de circuit imprimé (segments coudés) avec un nœud lumineux.
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(t * 0.7)
      ctx.lineWidth = 1.8
      ctx.lineJoin = 'round'
      ctx.setLineDash([])
      for (let i = 0; i < 3; i++) {
        ctx.save()
        ctx.rotate((i * Math.PI * 2) / 3)
        ctx.beginPath()
        ctx.moveTo(6, 0)
        ctx.lineTo(16, 0)
        ctx.lineTo(22, -9)
        ctx.lineTo(31, -9)
        ctx.lineTo(36, 3)
        ctx.stroke()
        ctx.fillStyle = '#ffffff'
        ctx.shadowColor = colorStr(1)
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(36, 3, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
      ctx.restore()

      // Point blanc central.
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(x, y, 5.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    function drawEye(side, ex, ey, w, h) {
      const p = params
      const bodyAlpha = 1 - clamp(Math.max(p.arc, p.cross, side > 0 ? p.wink : 0), 0, 1)
      if (bodyAlpha > 0.01) {
        ctx.save()
        ctx.globalAlpha = bodyAlpha
        const x0 = ex - w / 2
        const y0 = ey - h / 2

        // Zone visible : en dessous de la paupière (ligne droite ou inclinée).
        const cover = p.lid * h
        // Sans paupière, on laisse la lueur déborder en haut de l'œil.
        const glowRoom = p.glow * 1.8 * Math.max(0, 1 - p.lid * 12 - p.slant / 8)
        const outerY = y0 + cover - p.slant / 2 - glowRoom
        const innerY = y0 + cover + p.slant / 2 - glowRoom
        // La ligne de paupière passe par les bords extérieur/intérieur de
        // l'œil ; on la prolonge de 40 px de chaque côté pour que le clip
        // couvre aussi la lueur.
        const edgeOuterX = ex + side * (w / 2)
        const edgeInnerX = ex - side * (w / 2)
        const slope = (innerY - outerY) / (edgeInnerX - edgeOuterX)
        const outerX = edgeOuterX + side * 40
        const innerX = edgeInnerX - side * 40
        ctx.beginPath()
        ctx.moveTo(outerX, outerY + slope * (outerX - edgeOuterX))
        ctx.lineTo(innerX, innerY + slope * (innerX - edgeInnerX))
        ctx.lineTo(innerX, y0 + h + 80)
        ctx.lineTo(outerX, y0 + h + 80)
        ctx.closePath()
        ctx.clip()

        ctx.fillStyle = colorStr(1)
        ctx.shadowColor = colorStr(0.85)
        ctx.shadowBlur = p.glow
        roundRectPath(ctx, x0, y0, w, h, p.r)
        ctx.fill()
        ctx.shadowBlur = 0

        // Reflet blanc.
        if (p.hi > 0.01) {
          ctx.globalAlpha = bodyAlpha * p.hi
          ctx.fillStyle = '#ffffff'
          // Le reflet se place dans la partie visible, sous la paupière.
          const hx = x0 + w * 0.22
          const lidAtX = y0 + cover - p.slant / 2 + slope * (hx - edgeOuterX)
          const hy = lidAtX + (y0 + h - lidAtX) * 0.2
          ctx.beginPath()
          ctx.arc(hx, hy, Math.max(4, w * 0.065), 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = bodyAlpha
        }

        if (p.iris > 0.01) drawIris(ex, ey - 4, p.iris * bodyAlpha)
        ctx.restore()
      }

      if (p.ring > 0.01) {
        ctx.save()
        ctx.globalAlpha = p.ring * (0.65 + 0.35 * Math.sin(t * 7))
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 4.5
        ctx.shadowColor = 'rgba(255,255,255,0.9)'
        ctx.shadowBlur = 10
        roundRectPath(ctx, ex - w / 2 - 7, ey - h / 2 - 7, w + 14, h + 14, p.r + 7)
        ctx.stroke()
        ctx.restore()
      }
      if (p.arc > 0.01) drawArc(ex, ey, p.arc, 20)
      if (side > 0 && p.wink > 0.01) drawArc(ex, ey - 5, p.wink, 20)
      if (p.cross > 0.01) drawCross(ex, ey, p.cross)
    }

    function drawMouth(cx, cy) {
      const a = params.mouth
      if (a < 0.01) return
      ctx.save()
      ctx.globalAlpha = a
      ctx.translate(cx, cy)
      ctx.fillStyle = colorStr(1)
      ctx.shadowColor = colorStr(0.8)
      ctx.shadowBlur = 14
      ctx.beginPath()
      ctx.moveTo(-40, 0)
      ctx.lineTo(40, 0)
      ctx.bezierCurveTo(40, 36, -40, 36, -40, 0)
      ctx.closePath()
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.clip()
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.beginPath()
      ctx.ellipse(0, 27, 21, 11, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
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

    function drawNotepad(cx, cy) {
      const a = params.notepad
      if (a < 0.01) return
      ctx.save()
      ctx.globalAlpha = a
      ctx.translate(cx, cy + Math.sin(t * 5) * 1.2)
      // Bloc-notes.
      ctx.fillStyle = '#04202b'
      ctx.strokeStyle = colorStr(1)
      ctx.lineWidth = 3
      ctx.shadowColor = colorStr(0.7)
      ctx.shadowBlur = 8
      roundRectPath(ctx, -37, -28, 74, 56, 7)
      ctx.fill()
      ctx.stroke()
      ctx.shadowBlur = 0
      // Lignes qui s'écrivent.
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      const lens = [0.85, 0.55, 0.7]
      for (let i = 0; i < 3; i++) {
        const grow = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.2 + i * 1.3))
        ctx.beginPath()
        ctx.moveTo(-26, -13 + i * 12)
        ctx.lineTo(-26 + 50 * lens[i] * grow, -13 + i * 12)
        ctx.stroke()
      }
      // Mains.
      ctx.fillStyle = colorStr(1)
      ctx.beginPath()
      ctx.ellipse(-42, 17, 13, 10, 0.3, 0, Math.PI * 2)
      ctx.ellipse(42, 17, 13, 10, -0.3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    function drawThumb(cx, cy) {
      const a = params.thumb
      if (a < 0.01) return
      ctx.save()
      ctx.globalAlpha = a
      ctx.translate(cx, cy)
      ctx.fillStyle = colorStr(1)
      ctx.shadowColor = colorStr(0.7)
      ctx.shadowBlur = 8
      // Poignet.
      ctx.save()
      ctx.fillStyle = 'rgba(0, 150, 170, 1)'
      roundRectPath(ctx, -38, -6, 12, 32, 3)
      ctx.fill()
      ctx.restore()
      // Pouce levé.
      roundRectPath(ctx, -12, -34, 17, 40, 7)
      ctx.fill()
      // Poing.
      roundRectPath(ctx, -24, -8, 55, 32, 9)
      ctx.fill()
      ctx.shadowBlur = 0
      // Doigts.
      ctx.strokeStyle = 'rgba(0, 60, 80, 0.9)'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.moveTo(-1, 2 + i * 8)
        ctx.lineTo(25, 2 + i * 8)
        ctx.stroke()
      }
      ctx.restore()
    }


    // ---------------------------------------------------------------- hibou
    // Petit hibou à grosse tête, posé sur une branche dans le cadre noir.
    // Tout est dessiné en code et teinté par la couleur courante des yeux
    // (accent du thème, ou ambre/rouge/vert selon l'humeur). Les yeux sont
    // ceux des 14 humeurs, simplement réduits (EYE_SCALE) pour tenir dans la tête.

    const EYE_SCALE = 0.72
    const EYE_CENTER_Y = 84 // où tombe cy = 100 (centre des yeux) sur le cadre

    function shade(f, a) {
      return 'rgba(' + Math.round(params.r_ * f) + ',' + Math.round(params.g_ * f) + ',' + Math.round(params.b_ * f) + ',' + (a === undefined ? 1 : a) + ')'
    }

    function cream(a) {
      // Bec : la couleur courante très éclaircie.
      const m = (v) => Math.round(v + (255 - v) * 0.78)
      return 'rgba(' + m(params.r_) + ',' + m(params.g_) + ',' + m(params.b_) + ',' + (a === undefined ? 1 : a) + ')'
    }

    function radial(cx, cy, r, inner, outer) {
      const g = ctx.createRadialGradient(cx, cy - r * 0.25, r * 0.1, cx, cy, r)
      g.addColorStop(0, inner)
      g.addColorStop(1, outer)
      return g
    }

    // Style sobre : silhouettes sombres sans contour, légèrement plus claires
    // que le cadre noir, avec un liseré de lumière sur le dessus ; seuls les
    // yeux brillent vraiment.

    function vgrad(y0, y1, top, bottom) {
      const g = ctx.createLinearGradient(0, y0, 0, y1)
      g.addColorStop(0, top)
      g.addColorStop(1, bottom)
      return g
    }

    function rim(drawPath, alpha) {
      // Liseré lumineux : un trait fin qui s'efface sur les côtés et le bas.
      ctx.save()
      ctx.strokeStyle = vgrad(0, 120, shade(1, alpha), shade(1, 0))
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      drawPath()
      ctx.stroke()
      ctx.restore()
    }

    function drawBranch() {
      ctx.save()
      ctx.lineCap = 'round'
      ctx.strokeStyle = '#1d150f'
      ctx.lineWidth = 13
      ctx.beginPath()
      ctx.moveTo(-14, 224)
      ctx.quadraticCurveTo(200, 217, 414, 226)
      ctx.stroke()
      // Brindille et deux feuilles discrètes.
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(330, 222)
      ctx.quadraticCurveTo(352, 214, 364, 196)
      ctx.stroke()
      ctx.fillStyle = shade(0.26)
      for (const [x, y, rot] of [[366, 194, -1.0], [356, 208, -0.1]]) {
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rot)
        ctx.beginPath()
        ctx.ellipse(8, 0, 12, 5, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
      ctx.restore()
    }

    function drawFeet() {
      ctx.save()
      ctx.strokeStyle = cream(0.8)
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      for (const x of [178, 222]) {
        for (const a of [-0.55, 0, 0.55]) {
          ctx.beginPath()
          ctx.moveTo(x, 216)
          ctx.lineTo(x + Math.sin(a) * 14, 216 + Math.cos(a) * 10)
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    function drawWing(side, flapAmp, spread) {
      // Aile repliée le long du corps, pointe vers le bas ; dessinée pour le
      // côté droit puis retournée pour le gauche.
      ctx.save()
      ctx.translate(200 + side * 70, 158)
      const swing = Math.sin(t * 11) * flapAmp * 0.25 + (flapAmp > 0 ? Math.sin(t * 17) * flapAmp * 0.05 : 0)
      ctx.rotate(side * (swing + spread * 0.045))
      ctx.scale(side, 1)
      ctx.fillStyle = vgrad(0, 62, shade(0.4), shade(0.24))
      ctx.beginPath()
      ctx.moveTo(-8, 0)
      ctx.bezierCurveTo(20, 10, 22, 44, -12, 62)
      ctx.bezierCurveTo(-26, 44, -26, 14, -16, 2)
      ctx.closePath()
      ctx.fill()
      // Liseré sur le bord extérieur de l'aile.
      ctx.strokeStyle = shade(1, 0.4)
      ctx.lineWidth = 1.8
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-8, 1)
      ctx.bezierCurveTo(20, 10, 22, 44, -12, 62)
      ctx.stroke()
      ctx.restore()
    }

    function drawBody() {
      ctx.save()
      // Corps en poire : épaules étroites sous la tête, large assise sur la branche.
      ctx.fillStyle = vgrad(146, 226, shade(0.28), shade(0.15))
      ctx.beginPath()
      ctx.moveTo(144, 148)
      ctx.bezierCurveTo(108, 164, 104, 204, 130, 217)
      ctx.quadraticCurveTo(200, 233, 270, 217)
      ctx.bezierCurveTo(296, 204, 292, 164, 256, 148)
      ctx.closePath()
      ctx.fill()
      // Ventre un peu plus clair.
      ctx.fillStyle = shade(0.34, 0.7)
      ctx.beginPath()
      ctx.ellipse(200, 190, 34, 28, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    function drawTuft(side, lift, spread) {
      const apexY = Math.max(2, 6 - lift)
      ctx.save()
      ctx.translate(200 + side * (88 + spread * 0.4), 0)
      const path = () => {
        ctx.beginPath()
        ctx.moveTo(-side * 34, 38)
        ctx.quadraticCurveTo(side * 6, apexY + 24, side * 14, apexY)
        ctx.quadraticCurveTo(side * 34, apexY + 16, side * 32, 46)
        ctx.closePath()
      }
      ctx.fillStyle = shade(0.2)
      path()
      ctx.fill()
      ctx.restore()
    }

    function drawHead(ly, lx) {
      const p = params
      // Tête : silhouette sombre + liseré lumineux sur le dessus.
      ctx.save()
      ctx.fillStyle = vgrad(6, 166, shade(0.24), shade(0.13))
      ctx.beginPath()
      ctx.ellipse(200, 88, 120, 78, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      rim(() => {
        ctx.beginPath()
        ctx.ellipse(200, 88, 119, 77, 0, Math.PI * 1.08, Math.PI * 1.92)
      }, 0.5)

      // Disques faciaux : un peu plus clairs, sans contour, doux autour des yeux.
      const discR = 56 + Math.max(0, p.h - 120) * 0.26
      const sepHalf = Math.max(48, (p.sep * EYE_SCALE) / 2)
      for (const side of [-1, 1]) {
        const cx = 200 + side * sepHalf + lx * 0.4
        const cy = EYE_CENTER_Y + ly * 0.4
        ctx.save()
        const g = ctx.createRadialGradient(cx, cy, discR * 0.35, cx, cy, discR)
        g.addColorStop(0, shade(0.3))
        g.addColorStop(1, shade(0.2, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(cx, cy, discR, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    function drawBeak(lx, ly) {
      const p = params
      ctx.save()
      ctx.translate(200 + lx * 0.7, 101 + ly * 0.5)
      ctx.scale(0.66, 0.66)
      ctx.shadowColor = shade(1, 0.5)
      ctx.shadowBlur = 6
      ctx.fillStyle = cream(1)
      ctx.beginPath()
      ctx.moveTo(-17, 0)
      ctx.quadraticCurveTo(0, -12, 17, 0)
      ctx.quadraticCurveTo(9, 22, 0, 32 - p.mouth * 3)
      ctx.quadraticCurveTo(-9, 22, -17, 0)
      ctx.closePath()
      ctx.fill()
      ctx.shadowBlur = 0
      // Rire : le bec s'ouvre, intérieur sombre puis bec du bas.
      if (p.mouth > 0.02) {
        const drop = p.mouth * 17
        ctx.fillStyle = 'rgba(0, 0, 0, ' + 0.7 * p.mouth + ')'
        ctx.beginPath()
        ctx.ellipse(0, 25 + drop * 0.45, 12, 2 + drop * 0.75, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = cream(p.mouth)
        ctx.beginPath()
        ctx.moveTo(-11, 26 + drop * 0.7)
        ctx.quadraticCurveTo(0, 44 + drop * 1.1, 11, 26 + drop * 0.7)
        ctx.quadraticCurveTo(0, 30 + drop * 0.8, -11, 26 + drop * 0.7)
        ctx.fill()
      }
      ctx.restore()
    }

    function drawOwlScene(lx, ly, shakeX, shakeY, bounceY, w, h, cy) {
      const p = params
      drawBranch()

      ctx.save()
      // Le hibou entier saute (rire, excité) ; la branche reste en place.
      ctx.translate(shakeX * 0.6, bounceY)
      drawFeet()
      drawBody()
      drawWing(-1, p.flap, p.spread)
      drawWing(1, p.flap, p.spread)

      // Tête : s'affaisse (somnolent), se gonfle (peur), s'incline vers le curseur.
      ctx.save()
      ctx.translate(0, p.sink)
      ctx.translate(200, 160)
      ctx.rotate(lookX * 0.05 * p.look)
      ctx.scale(p.puff, p.puff)
      ctx.translate(-200, -160)
      drawTuft(-1, p.tuft, p.spread)
      drawTuft(1, p.tuft, p.spread)
      drawHead(ly * EYE_SCALE, lx * EYE_SCALE)

      // Les yeux des humeurs, réduits pour tenir dans les disques faciaux.
      ctx.save()
      ctx.translate(200, EYE_CENTER_Y)
      ctx.scale(EYE_SCALE, EYE_SCALE)
      ctx.translate(-200, -100)
      const half = p.sep / 2
      drawEye(-1, W / 2 - half + lx + shakeX, cy, w, h)
      drawEye(1, W / 2 + half + lx + shakeX, cy, w, h)
      ctx.restore()

      drawBeak(lx * EYE_SCALE, ly * EYE_SCALE)
      ctx.restore() // tête

      // Accessoires tenus devant le ventre (par-dessus la tête qui s'affaisse).
      ctx.save()
      ctx.translate(200, 198)
      ctx.scale(0.78, 0.78)
      ctx.translate(-200, -196)
      drawNotepad(W / 2, 196)
      drawThumb(W / 2 - 4, 188)
      ctx.restore()
      ctx.restore() // hibou

      drawZzz()
    }

    function render() {
      const p = params
      const dpr = canvas.width / W
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // Panneau noir aux coins arrondis.
      ctx.save()
      roundRectPath(ctx, 0, 0, W, H, PANEL_RADIUS)
      ctx.fillStyle = '#000'
      ctx.fill()
      ctx.clip()

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

      if (p.owl > 0.5) {
        drawOwlScene(lx, ly, shakeX, shakeY, bounceY, w, h, p.cy + ly + shakeY)
      } else {
        // Mascotte « yeux seuls ».
        const cy = p.cy + ly + shakeY + bounceY
        const half = p.sep / 2
        drawEye(-1, W / 2 - half + lx + shakeX, cy, w, h)
        drawEye(1, W / 2 + half + lx + shakeX, cy, w, h)
        drawMouth(W / 2 + lx * 0.4 + shakeX, 187 + bounceY)
        drawZzz()
        drawNotepad(W / 2, 196)
        drawThumb(W / 2 - 4, 188)
      }

      ctx.restore()
    }

    return { setMood, setBaseColor, setMascot, setLook, step, render, snap, params }
  }

  global.HubiEyes = { createEyes, MOOD_NAMES, TRANSIENT_MS, W, H, hueClose }
})(window)

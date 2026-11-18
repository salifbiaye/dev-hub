/* Hubi — l'île : une petite pastille noire collée en haut de l'écran, au
 * centre, comme la Dynamic Island d'un MacBook.
 *
 * Au repos elle ne montre que les yeux de Hubi. Quand il y a quelque chose à
 * dire (sessions IA en cours, minuteur, tâches, message), elle s'élargit en
 * douceur, puis se resserre. Dessinée dans le canevas 440 x 132 ; seule la
 * pastille prend les clics (les zones sont renvoyées à Python).
 */
;(function (global) {
  'use strict'

  const W = 440
  const H = 132
  const TOP = 6 // marge entre le haut du canevas et la pastille
  const PEEK = 4 // ce qui dépasse du bord de l'écran quand elle est rangée
  const REST_W = 90
  const REST_H = 40
  const FONT = "600 13px 'Segoe UI', system-ui, sans-serif"
  const FONT_SMALL = "600 12px 'Segoe UI', system-ui, sans-serif"
  const LINE_H = 17
  const EYES_W = 52 // largeur réservée à Hubi
  const PAD = 14
  const GAP = 14

  const TONES = {
    ok: [105, 240, 174],
    warn: [255, 193, 7],
    error: [255, 82, 82],
  }
  const TOOL_STYLE = {
    claude: { color: [217, 119, 87], label: 'Claude' },
    claude_agents: { color: [240, 170, 140], label: 'agent', plural: 'agents' },
    codex: { color: [180, 190, 200], label: 'Codex' },
  }

  const rgba = (c, a) => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a === undefined ? 1 : a) + ')'

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text
    let s = text
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
    return s.trimEnd() + '…'
  }

  // Au plus deux lignes, coupées aux espaces.
  function wrap(ctx, text, maxW) {
    const words = text.split(' ')
    let first = ''
    let i = 0
    for (; i < words.length; i++) {
      const next = first ? first + ' ' + words[i] : words[i]
      if (ctx.measureText(next).width > maxW) break
      first = next
    }
    if (!first) return [ellipsize(ctx, text, maxW)]
    if (i >= words.length) return [first]
    return [first, ellipsize(ctx, words.slice(i).join(' '), maxW)]
  }

  function formatRemaining(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const pad = (v) => String(v).padStart(2, '0')
    return h ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s)
  }

  function create(canvas, eyes) {
    const ctx = canvas.getContext('2d')
    // Taille animée de la pastille.
    let cur = { w: REST_W, h: REST_H }
    let retr = 0 // 0 : sortie, 1 : rangée au-dessus du bord de l'écran (seul un liseré dépasse)
    let centered = 1 // 1 : les yeux seuls au milieu ; 0 : calés à gauche, du contenu à droite
    let t = 0

    // Petit pictogramme d'état, à droite des yeux : seulement quand il sert.
    function glyphFor(mood) {
      if (eyes.params.zzz > 0.5) return 'zzz'
      if (mood === 'acting') return 'spin'
      if (mood === 'listening') return 'lines'
      if (mood === 'alert') return 'bang'
      if (mood === 'happy' || mood === 'understood') return 'check'
      return null
    }

    function drawGlyph(kind, x, cy, accent) {
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (kind === 'spin') {
        ctx.strokeStyle = rgba(accent)
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.arc(x + 8, cy, 6.5, t * 5, t * 5 + 4.2)
        ctx.stroke()
      } else if (kind === 'bang') {
        ctx.fillStyle = rgba(TONES.warn)
        ctx.font = "700 17px 'Segoe UI', system-ui, sans-serif"
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('!', x + 8, cy + 1)
      } else if (kind === 'check') {
        ctx.strokeStyle = rgba(TONES.ok)
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.moveTo(x + 2, cy + 1)
        ctx.lineTo(x + 7, cy + 6)
        ctx.lineTo(x + 15, cy - 5)
        ctx.stroke()
      } else if (kind === 'lines') {
        ctx.strokeStyle = rgba(accent)
        ctx.lineWidth = 2
        for (let i = 0; i < 3; i++) {
          ctx.beginPath()
          ctx.moveTo(x + 2, cy - 6 + i * 6)
          ctx.lineTo(x + 14 - i * 4, cy - 6 + i * 6)
          ctx.stroke()
        }
      } else if (kind === 'zzz') {
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        const a = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.6))
        ctx.globalAlpha = a
        ctx.font = "700 12px 'Segoe UI', system-ui, sans-serif"
        ctx.fillText('z', x + 1, cy + 3)
        ctx.font = "700 9px 'Segoe UI', system-ui, sans-serif"
        ctx.fillText('z', x + 10, cy - 3)
      }
      ctx.restore()
    }

    // Ce qui s'affiche à droite des yeux, mesuré pour dimensionner la pastille.
    function buildChips(state, accent) {
      const chips = []
      ctx.font = FONT_SMALL
      const sessions = Object.keys(TOOL_STYLE)
        .filter((k) => state.sessions && state.sessions[k] > 0)
        .map((k) => {
          const st = TOOL_STYLE[k]
          const label = state.sessions[k] > 1 && st.plural ? st.plural : st.label
          return { text: state.sessions[k] + ' ' + label, color: st.color }
        })
      if (sessions.length) {
        const widths = sessions.map((s) => ctx.measureText(s.text).width)
        const w = widths.reduce((a, b) => a + b, 0) + sessions.length * 13 + (sessions.length - 1) * 12
        chips.push({
          w,
          draw(x, cy) {
            ctx.font = FONT_SMALL
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            let cx = x
            sessions.forEach((s, i) => {
              ctx.fillStyle = rgba(s.color)
              ctx.beginPath()
              ctx.arc(cx + 4, cy, 3.6, 0, Math.PI * 2)
              ctx.fill()
              ctx.fillStyle = 'rgba(255,255,255,0.88)'
              ctx.fillText(s.text, cx + 13, cy + 0.5)
              cx += 13 + widths[i] + 12
            })
          },
        })
      }
      if (state.timer) {
        const left = state.timer.end - Date.now()
        const text = formatRemaining(left)
        const color = left < 60000 ? TONES.warn : accent
        ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif"
        const w = ctx.measureText(text).width + 17
        chips.push({
          w,
          draw(x, cy) {
            ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif"
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            ctx.strokeStyle = rgba(color)
            ctx.lineWidth = 1.7
            ctx.beginPath()
            ctx.arc(x + 5.5, cy, 5, 0, Math.PI * 2)
            ctx.moveTo(x + 5.5, cy - 3)
            ctx.lineTo(x + 5.5, cy)
            ctx.lineTo(x + 8, cy + 1.5)
            ctx.stroke()
            ctx.fillStyle = rgba(color)
            ctx.fillText(text, x + 15, cy + 0.5)
          },
        })
      }
      if (state.openTasks > 0) {
        const text = String(state.openTasks)
        ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif"
        const w = ctx.measureText(text).width + 19
        chips.push({
          w,
          draw(x, cy) {
            ctx.strokeStyle = rgba(accent)
            ctx.lineWidth = 1.8
            roundRect(ctx, x, cy - 6, 12, 12, 3)
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(x + 2.8, cy)
            ctx.lineTo(x + 5.3, cy + 2.6)
            ctx.lineTo(x + 9.4, cy - 2.6)
            ctx.stroke()
            ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif"
            ctx.fillStyle = rgba(accent)
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            ctx.fillText(text, x + 19, cy + 0.5)
          },
        })
      }
      return chips
    }

    /** state: { dt, mood, bubble, timer, openTasks, sessions, accent }. Returns the clickable rects. */
    function render(dt, state) {
      t += Math.min(dt, 0.1)
      const dpr = canvas.width / W
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      const accent = state.accent || [0, 229, 255]
      // Rangée : plus de contenu, la pastille remonte et laisse libre ce qu'il y a dessous.
      const retracted = !!state.retracted && !state.bubble
      const glyph = retracted ? null : glyphFor(state.mood)
      const bubble = state.bubble
      let lines = null
      let chips = []
      let contentW = 0
      const glyphW = glyph ? 22 : 0

      if (bubble) {
        ctx.font = FONT
        const maxText = 300
        lines = wrap(ctx, bubble.text, maxText)
        const textW = Math.max(...lines.map((l) => ctx.measureText(l).width))
        contentW = textW + 6
      } else {
        chips = retracted ? [] : buildChips(state, accent)
        contentW = chips.reduce((a, c) => a + c.w, 0) + Math.max(0, chips.length - 1) * GAP
      }
      const extra = contentW > 0 ? GAP + contentW : 0
      const targetW = Math.max(REST_W, PAD + EYES_W + (glyphW ? 4 + glyphW : 0) + extra + PAD)
      const targetH = lines && lines.length > 1 ? 56 : REST_H + (bubble ? 4 : 0)

      const k = 1 - Math.exp(-Math.min(dt, 0.1) * 13)
      cur.w += (targetW - cur.w) * k
      cur.h += (targetH - cur.h) * k
      retr += ((retracted ? 1 : 0) - retr) * k
      const w = cur.w
      const h = cur.h
      const x = (W - w) / 2
      const y = TOP + (PEEK - h - TOP) * retr
      const cy = y + h / 2

      // Pastille : noire, avec un fin liseré de lumière.
      const tone = bubble ? TONES[bubble.tone] || accent : null
      roundRect(ctx, x, y, w, h, h / 2 > 24 ? 24 : h / 2)
      ctx.fillStyle = '#000'
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = tone ? rgba(tone, 0.55) : 'rgba(255,255,255,0.09)'
      ctx.stroke()

      // Hubi, en petit, dans la pastille.
      const wantCentered = glyph || contentW > 0 ? 0 : 1
      centered += (wantCentered - centered) * k
      const eyesCx = x + PAD + EYES_W / 2 + ((x + w / 2) - (x + PAD + EYES_W / 2)) * centered
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - retr * 1.7) // rangée : plus rien de Hubi ne dépasse
      eyes.drawIslandMascot(eyesCx, cy, 0.27)
      ctx.restore()

      let cursor = x + PAD + EYES_W
      if (glyph) {
        drawGlyph(glyph, cursor + 4, cy, accent)
        cursor += 4 + glyphW
      }
      if (bubble && lines) {
        ctx.font = FONT
        ctx.fillStyle = '#f4f4f5'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        const top = cy - ((lines.length - 1) * LINE_H) / 2
        lines.forEach((line, n) => ctx.fillText(line, cursor + GAP, top + n * LINE_H + 0.5))
      } else {
        cursor += chips.length ? GAP : 0
        chips.forEach((c, i) => {
          if (i > 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.16)'
            ctx.fillRect(cursor - GAP / 2, cy - 6, 1, 12)
          }
          c.draw(cursor, cy)
          cursor += c.w + GAP
        })
      }

      // Rangée : seul le liseré qui dépasse reçoit la souris, tout le reste laisse passer.
      if (retr > 0.85) return [[x, 0, w, PEEK + 3, 3]]
      return [[x, Math.max(0, y), w, h, h / 2 > 24 ? 24 : h / 2]]
    }

    return { render }
  }

  global.HubiIsland = { create, W, H }
})(window)

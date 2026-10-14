/* Hubi — bulle de texte, badges (minuteur, tâches) et bips.
 *
 * Dessiné par-dessus les yeux, dans le même repère logique 400x240. Le
 * panneau est toujours noir : la couleur suit l'accent du thème (ou la
 * couleur de sens : vert = ok, ambre = attente, rouge = erreur).
 */
;(function (global) {
  'use strict'

  const W = 400
  const TONES = {
    ok: [105, 240, 174],
    warn: [255, 193, 7],
    error: [255, 82, 82],
  }
  const FONT = "600 26px 'Segoe UI', system-ui, sans-serif"
  const BADGE_FONT = "700 22px 'Segoe UI', system-ui, sans-serif"
  const LINE_H = 31

  function rgba(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'
  }

  function roundRect(ctx, x, y, w, h, r) {
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

  // Au plus deux lignes, coupées aux espaces ; le reste finit en « … ».
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

  function drawBubble(ctx, text, tone, accent, alpha) {
    const color = TONES[tone] || accent
    const x = 10
    const y = 150
    const w = W - 20
    const h = 82
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.font = FONT
    const lines = wrap(ctx, text, w - 30)
    roundRect(ctx, x, y, w, h, 16)
    ctx.fillStyle = rgba(color, 0.16)
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = rgba(color, 0.9)
    ctx.stroke()
    ctx.fillStyle = '#f4f4f5'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const top = y + h / 2 - ((lines.length - 1) * LINE_H) / 2
    lines.forEach((line, n) => ctx.fillText(line, W / 2, top + n * LINE_H))
    ctx.restore()
  }

  function drawBadge(ctx, text, right, color, icon) {
    ctx.save()
    ctx.font = BADGE_FONT
    const iconW = icon ? 22 : 0
    const w = ctx.measureText(text).width + 20 + iconW
    const h = 32
    const x = right ? W - 6 - w : 6
    const y = 6
    roundRect(ctx, x, y, w, h, 10)
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fill()
    if (icon === 'check') {
      // Petite case cochée.
      ctx.strokeStyle = rgba(color, 1)
      ctx.lineWidth = 2.2
      roundRect(ctx, x + 9, y + 9, 14, 14, 3)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x + 12, y + 16)
      ctx.lineTo(x + 15.5, y + 19.5)
      ctx.lineTo(x + 21, y + 12)
      ctx.stroke()
    }
    ctx.fillStyle = rgba(color, 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + 10 + iconW, y + h / 2 + 1)
    ctx.restore()
    return [x, y, w, h, 10]
  }

  // Sessions en cours par outil : « ● 2 Claude · ● 1 Codex », en haut à gauche
  // (sous le minuteur s'il y en a un).
  const TOOL_STYLE = {
    claude: { color: [217, 119, 87], label: 'Claude' },
    codex: { color: [180, 190, 200], label: 'Codex' },
  }

  function drawSessions(ctx, counts, y) {
    const parts = Object.keys(TOOL_STYLE)
      .filter((tool) => counts[tool] > 0)
      .map((tool) => ({ text: counts[tool] + ' ' + TOOL_STYLE[tool].label, color: TOOL_STYLE[tool].color }))
    if (!parts.length) return null
    ctx.save()
    ctx.font = BADGE_FONT
    const DOT = 14
    const GAP = 16
    const widths = parts.map((p) => ctx.measureText(p.text).width)
    const w = 20 + widths.reduce((a, b) => a + b, 0) + parts.length * DOT + (parts.length - 1) * GAP
    const h = 32
    const x = 6
    roundRect(ctx, x, y, w, h, 10)
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fill()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    let cx = x + 10
    parts.forEach((p, i) => {
      ctx.fillStyle = rgba(p.color, 1)
      ctx.beginPath()
      ctx.arc(cx + 4, y + h / 2, 4.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillText(p.text, cx + DOT, y + h / 2 + 1)
      cx += DOT + widths[i] + GAP
    })
    ctx.restore()
    return [x, y, w, h, 10]
  }

  function formatRemaining(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const pad = (v) => String(v).padStart(2, '0')
    return h ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s)
  }

  // ------------------------------------------------------------ bips

  let audio = null

  function tone(freq, start, dur, type) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = type || 'sine'
    osc.frequency.value = freq
    const t0 = audio.currentTime + start
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(0.2, t0 + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(gain).connect(audio.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  const BEEPS = {
    waiting: [[660, 0, 0.14], [880, 0.16, 0.18]],
    done: [[523, 0, 0.12], [784, 0.13, 0.22]],
    error: [[330, 0, 0.16, 'triangle'], [220, 0.18, 0.26, 'triangle']],
    timer: [[880, 0, 0.12], [880, 0.22, 0.12], [1175, 0.44, 0.3]],
  }

  function beep(kind) {
    const notes = BEEPS[kind]
    if (!notes) return
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)()
      const play = () => {
        for (const n of notes) tone(n[0], n[1], n[2], n[3])
      }
      // Notes scheduled while the context is still suspended would be lost.
      if (audio.state === 'suspended') audio.resume().then(play, () => {})
      else play()
    } catch (e) {
      // Pas d'audio disponible : tant pis.
    }
  }

  function unlockAudio() {
    if (audio && audio.state === 'suspended') audio.resume()
  }

  const BUBBLE_RECT = [10, 150, W - 20, 82, 16]

  global.HubiHud = {
    BUBBLE_RECT, drawBubble, drawBadge, drawSessions, formatRemaining, beep, unlockAudio, TONES }
})(window)

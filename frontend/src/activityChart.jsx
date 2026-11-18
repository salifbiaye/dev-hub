import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from './emptyState'
import { Select } from './themedSelect'

// "Graphique" view of the history: how many commits per person over time, as overlaid area
// chart (hand-drawn SVG, no chart library). Period picker on top, people as a legend you can
// switch on and off.

function api() {
  return window.pywebview?.api
}

// People's colours follow the theme: the first one is the theme's accent, the others are spread
// around the colour wheel from it (golden angle), so two people never end up with near-identical
// shades whatever the accent is (blue, orange, green…).
function parseHex(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec((c || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl([r, g, b]) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, sat, l]
}

function themeAccent() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim()
}

// Re-reads the accent when the theme changes (the app rewrites CSS variables on <html>).
function useAccent() {
  const [accent, setAccent] = useState(themeAccent)
  useEffect(() => {
    const ro = new MutationObserver(() => setAccent(themeAccent()))
    ro.observe(document.documentElement, { attributes: true })
    return () => ro.disconnect()
  }, [])
  return accent
}

function seriesColor(index, accent) {
  if (index === 0) return 'var(--color-accent)'
  const rgb = parseHex(accent)
  const [h, sat, l] = rgb ? rgbToHsl(rgb) : [260, 0.6, 0.6]
  const s2 = Math.min(0.85, Math.max(0.55, sat))
  const l2 = Math.min(0.66, Math.max(0.5, l))
  return `hsl(${Math.round((h + index * 137.5) % 360)} ${Math.round(s2 * 100)}% ${Math.round(l2 * 100)}%)`
}

const PERIODS = [
  { value: '30', label: '30 derniers jours' },
  { value: '90', label: '3 derniers mois' },
  { value: '180', label: '6 derniers mois' },
  { value: '365', label: '12 derniers mois' },
  { value: '0', label: "Tout l'historique" },
]
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const H = 270
const M = { l: 34, r: 14, t: 12, b: 28 }

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s) => new Date(`${s}T12:00:00`)

function useWidth(el) {
  const [w, setW] = useState(800)
  useEffect(() => {
    if (!el) return undefined
    setW(Math.max(320, Math.floor(el.getBoundingClientRect().width)))
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return w
}

// Smooth curve through the points that never overshoots (monotone cubic, like d3's curveMonotoneX).
function curve(pts) {
  const n = pts.length
  if (n < 2) return ''
  const d = []
  const t = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) d[i] = (pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0] || 1)
  t[0] = d[0]
  t[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
    } else {
      const a = t[i] / d[i]
      const b = t[i + 1] / d[i]
      const s = a * a + b * b
      if (s > 9) {
        const k = 3 / Math.sqrt(s)
        t[i] = k * a * d[i]
        t[i + 1] = k * b * d[i]
      }
    }
  }
  let out = ''
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i][0]) / 3
    out += `C${pts[i][0] + dx},${pts[i][1] + t[i] * dx} ${pts[i + 1][0] - dx},${pts[i + 1][1] - t[i + 1] * dx} ${pts[i + 1][0]},${pts[i + 1][1]}`
  }
  return out
}

function buildBuckets(data, days) {
  const end = parse(data.today)
  const first = data.first ? parse(data.first) : new Date(end.getTime() - 29 * 86400000)
  const start = days > 0 ? new Date(end.getTime() - days * 86400000) : first
  const span = Math.round((end - start) / 86400000)
  const unit = span <= 100 ? 'day' : span <= 420 ? 'week' : 'month'

  const keyOf = (s) => {
    const d = parse(s)
    if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Monday
    if (unit === 'month') d.setDate(1)
    return iso(d)
  }
  const keys = []
  const cursor = parse(keyOf(iso(start)))
  const last = parse(keyOf(iso(end)))
  while (cursor <= last) {
    keys.push(iso(cursor))
    if (unit === 'day') cursor.setDate(cursor.getDate() + 1)
    else if (unit === 'week') cursor.setDate(cursor.getDate() + 7)
    else cursor.setMonth(cursor.getMonth() + 1)
  }
  const index = new Map(keys.map((k, i) => [k, i]))
  const values = {}
  for (const a of data.authors) {
    values[a] = new Array(keys.length).fill(0)
    for (const [day, n] of Object.entries(data.series[a])) {
      const i = index.get(keyOf(day))
      if (i != null) values[a][i] += n
    }
  }
  return { keys, values, unit }
}

function labelOf(key, unit, long) {
  const d = parse(key)
  if (unit === 'month') return long ? `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` : `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  if (!long) return base
  return unit === 'week' ? `Semaine du ${base} ${d.getFullYear()}` : `${base} ${d.getFullYear()}`
}

// Four even steps of a round size (1, 2, 5, 10, 20, 50…): the smallest that covers the tallest value.
function niceMax(max) {
  for (let p10 = 1; p10 <= 1e7; p10 *= 10) {
    for (const mult of [1, 2, 5]) {
      if (mult * p10 * 4 >= max) return mult * p10 * 4
    }
  }
  return 4
}

// One drawing: axes, areas, crosshair and tooltip. The crosshair position is
// shared between drawings so the same day lights up on every chart.
function Panel({ uid, keys, unit, width, height, layers, ymax, colorOf, hover, setHover, showX, onlyOne, soft, totalLine }) {
  const mb = showX ? M.b : 8
  const iw = width - M.l - M.r
  const ih = height - M.t - mb
  const n = keys.length
  const x = (i) => M.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1))
  const y = (v) => M.t + ih - (v / ymax) * ih
  const ticks = [0, 1, 2, 3, 4].map((k) => (ymax * k) / 4)
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(iw / 80))))

  function move(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - r.left - M.l
    setHover(Math.max(0, Math.min(n - 1, Math.round((mx / iw) * (n - 1)))))
  }

  return (
    <div className="relative">
      <svg width={width} height={height} onMouseMove={move} onMouseLeave={() => setHover(null)} className="block select-none">
        <defs>
          {layers.map((l) => (
            <linearGradient key={l.author} id={`area-${uid}-${l.index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: colorOf(l.author) }} stopOpacity={soft ? 0.38 : 0.6} />
              <stop offset="100%" style={{ stopColor: colorOf(l.author) }} stopOpacity={soft ? 0.03 : 0.08} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={width - M.r} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-border" strokeOpacity={t === 0 ? 0.9 : 0.5} />
            <text x={M.l - 8} y={y(t) + 3.5} textAnchor="end" className="fill-muted text-[10.5px]">
              {t}
            </text>
          </g>
        ))}
        {n >= 2 &&
          layers.map((l) => {
            const top = l.top.map((v, i) => [x(i), y(v)])
            const bottom = l.bottom.map((v, i) => [x(i), y(v)]).reverse()
            const line = `M${top[0][0]},${top[0][1]}${curve(top)}`
            const shape = `${line}L${bottom[0][0]},${bottom[0][1]}${curve(bottom)}Z`
            return (
              <g key={l.author}>
                <path d={shape} fill={`url(#area-${uid}-${l.index})`} />
                <path d={line} fill="none" strokeWidth={soft ? 2 : 1.6} style={{ stroke: colorOf(l.author) }} />
              </g>
            )
          })}
        {n >= 2 && totalLine && (() => {
          const pts = totalLine.map((v, i) => [x(i), y(v)])
          return <path d={`M${pts[0][0]},${pts[0][1]}${curve(pts)}`} fill="none" strokeWidth="1.5" strokeDasharray="5 4" stroke="currentColor" className="text-text" strokeOpacity="0.55" />
        })()}
        {showX &&
          keys.map((k, i) =>
            i % every === 0 ? (
              <text key={k} x={x(i)} y={height - 8} textAnchor="middle" className="fill-muted text-[10.5px]">
                {labelOf(k, unit, false)}
              </text>
            ) : null,
          )}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih} stroke="currentColor" className="text-muted" strokeOpacity="0.5" strokeDasharray="3 3" />
            {totalLine && <circle cx={x(hover)} cy={y(totalLine[hover])} r="3" className="fill-surface text-text" strokeWidth="1.5" stroke="currentColor" />}
            {(
              layers.map((l) => <circle key={l.author} cx={x(hover)} cy={y(l.top[hover])} r="3.5" className="fill-surface" strokeWidth="2" style={{ stroke: colorOf(l.author) }} />)
            )}
          </g>
        )}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-md border border-border-strong bg-surface px-3 py-2 text-[12px] shadow-xl"
          style={{ left: Math.min(Math.max(x(hover) + 12, 4), width - 180) }}
        >
          <p className="mb-1 font-medium text-text">{labelOf(keys[hover], unit, true)}</p>
          {layers
            .slice()
            .reverse()
            .map((l) => (
              <p key={l.author} className="flex items-center gap-2 text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: colorOf(l.author) }} />
                <span className="flex-1 truncate">{onlyOne ? 'commits' : l.author}</span>
                <span className="tabular-nums text-text">{l.top[hover] - l.bottom[hover]}</span>
              </p>
            ))}
          {totalLine && layers.length > 1 && (
            <p className="mt-1 flex items-center gap-2 border-t border-border pt-1 text-muted">
              <span className="flex-1">Total</span>
              <span className="tabular-nums font-medium text-text">{totalLine[hover]}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function ActivityChart({ repo, refreshSignal }) {
  const [period, setPeriod] = useState('90')
  const [mode, setMode] = useState('overlay') // overlay: per period | total: running totals
  const [data, setData] = useState(null)
  const [off, setOff] = useState(() => new Set()) // people switched off in the legend
  const [hover, setHover] = useState(null)
  const [wrap, setWrap] = useState(null)
  const width = useWidth(wrap)
  const accent = useAccent()

  useEffect(() => {
    let cancelled = false
    api()
      ?.repo_activity?.(repo.path, Number(period))
      ?.then((r) => !cancelled && r && !r.error && setData(r))
    return () => {
      cancelled = true
    }
  }, [repo.path, period, refreshSignal])

  const days = Number(period)
  const { keys, values, unit } = useMemo(() => (data ? buildBuckets(data, days) : { keys: [], values: {}, unit: 'day' }), [data, days])
  const authors = data?.authors || []
  const people = authors.filter((a) => !off.has(a))
  const colorOf = (a) => seriesColor(Math.max(0, authors.indexOf(a)), accent)
  const totalOf = (a) => (values[a] || []).reduce((s, v) => s + v, 0)

  // every person drawn from zero, on the same scale (a stack would make the top colour look like the biggest)
  const { solo, running, runningTotal, ymaxSolo, ymaxRunning } = useMemo(() => {
    const n = keys.length
    const base = new Array(n).fill(0)
    const soloLayers = []
    let tallest = 1
    for (const a of people) {
      const v = values[a] || new Array(n).fill(0)
      base.forEach((_, i) => (base[i] += v[i] || 0))
      soloLayers.push({ author: a, index: authors.indexOf(a), bottom: new Array(n).fill(0), top: [...v] })
      tallest = Math.max(tallest, ...v)
    }
    soloLayers.sort((p, q) => Math.max(...q.top) - Math.max(...p.top))
    // running totals: how many commits each person has made so far, from the start of the period
    const runningLayers = soloLayers.map((l) => {
      let acc = 0
      return { ...l, top: l.top.map((v) => (acc += v)) }
    })
    const runningSum = base.length ? base.map((_, i) => runningLayers.reduce((sum, l) => sum + l.top[i], 0)) : []
    return {
      running: runningLayers,
      runningTotal: runningSum,
      ymaxRunning: niceMax(Math.max(1, ...runningSum)),
      solo: soloLayers,
      ymaxSolo: niceMax(tallest),
    }
  }, [keys, values, people, authors])

  if (!data) {
    return (
      <div ref={setWrap}>
        <p className="py-6 text-center text-[12.5px] text-muted">Analyse de l'historique…</p>
      </div>
    )
  }

  const shownTotal = people.reduce((s, a) => s + totalOf(a), 0)
  const common = { keys, unit, width, colorOf, hover, setHover }

  return (
    <div ref={setWrap}>
      <div className="mb-3 flex items-center gap-4">
        <div className="w-44 shrink-0">
          <Select
            value={period}
            onChange={setPeriod}
            options={PERIODS}
            title="Période"
            className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[12.5px] text-text hover:border-border-strong"
          />
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-surface-hover/50 p-0.5 text-[12px]">
          {[
            ['overlay', 'Comparer'],
            ['total', 'Cumulé'],
          ].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setMode(id)} className={`cursor-pointer rounded px-2.5 py-1 ${mode === id ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'}`}>
              {label}
            </button>
          ))}
        </div>
        <div
          className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
          onWheel={(e) => {
            // the mouse wheel scrolls the legend sideways
            if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY
          }}
        >
          {authors.map((a) => {
            const isOff = off.has(a)
            return (
              <button
                key={a}
                type="button"
                onClick={() =>
                  setOff((prev) => {
                    const next = new Set(prev)
                    if (next.has(a)) next.delete(a)
                    else next.add(a)
                    return next
                  })
                }
                className={`flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[12px] transition-opacity ${isOff ? 'border-border text-muted opacity-50' : 'border-border-strong text-text'}`}
                title={isOff ? 'Afficher' : 'Masquer'}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: colorOf(a) }} />
                {a}
                <span className="tabular-nums text-muted">{totalOf(a)}</span>
              </button>
            )
          })}
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-muted">
          {shownTotal.toLocaleString('fr-FR')} commit{shownTotal > 1 ? 's' : ''}
        </span>
      </div>

      {data.total === 0 ? (
        <EmptyState title="Aucune activité sur cette période">Choisis une période plus large pour voir l'évolution des commits.</EmptyState>
      ) : people.length === 0 ? (
        <EmptyState title="Personne n'est affiché">Réactive au moins une personne dans la légende.</EmptyState>
      ) : mode === 'total' ? (
        <Panel {...common} uid="run" height={H} layers={running} ymax={ymaxRunning} showX soft totalLine={runningTotal} />
      ) : (
        <Panel {...common} uid="over" height={H} layers={solo} ymax={ymaxSolo} showX soft />
      )}
    </div>
  )
}

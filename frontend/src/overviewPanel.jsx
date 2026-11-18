import { useEffect, useMemo, useRef, useState } from 'react'
import { IconFolder, IconBranch } from './icons'
import { EditableIcon } from './projectIcon'
import { EmptyState } from './emptyState'
import { Select } from './themedSelect'
import { ActivityChart } from './activityChart'

// The project's "Aperçu" tab, in the spirit of a GitHub profile: a big icon, the project's
// numbers, and a heatmap of the commits per day.

function api() {
  return window.pywebview?.api
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const GAP = 3

// Colors of the languages in the bar (the common ones; others get a neutral tone).
const LANG_COLOR = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572a5',
  Java: '#b07219',
  Kotlin: '#a97bff',
  Go: '#00add8',
  Rust: '#dea584',
  PHP: '#4f5d95',
  Ruby: '#701516',
  'C#': '#178600',
  C: '#555555',
  'C++': '#f34b7d',
  Swift: '#f05138',
  Dart: '#00b4ab',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  SQL: '#e38c00',
  Shell: '#89e051',
  PowerShell: '#012456',
}

const level = (n, max) => (n <= 0 ? 0 : Math.max(1, Math.ceil((4 * n) / Math.max(max, 1))))
const levelColor = (l) => (l === 0 ? 'color-mix(in srgb, var(--color-text) 7%, transparent)' : `color-mix(in srgb, var(--color-accent) ${[0, 30, 55, 80, 100][l]}%, transparent)`)

function fmtDay(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

function Heatmap({ data }) {
  const { weeks, months, max } = useMemo(() => {
    const now = new Date()
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const start = new Date(`${data.start}T00:00:00`)
    const end = new Date(`${data.end}T00:00:00`)
    const weeks = []
    const months = []
    let lastMonth = -1
    let max = 0
    for (let cursor = new Date(start), w = 0; cursor <= end; w++) {
      const col = []
      for (let i = 0; i < 7; i++) {
        const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
        const inRange = cursor <= end && iso >= (data.year ? `${data.year}-01-01` : '0000')
        const n = inRange ? data.days[iso] || 0 : -1
        if (n > max) max = n
        col.push({ iso, n, future: iso > todayIso })
        if (i === 0 && cursor.getMonth() !== lastMonth && inRange) {
          months.push({ week: w, label: MONTHS[cursor.getMonth()] })
          lastMonth = cursor.getMonth()
        }
        cursor.setDate(cursor.getDate() + 1)
      }
      weeks.push(col)
    }
    return { weeks, months, max }
  }, [data])

  // The cells grow to fill the frame (between 10 and 26 px), instead of leaving empty space on the right.
  const box = useRef(null)
  const [boxW, setBoxW] = useState(0)
  useEffect(() => {
    if (!box.current) return undefined
    const ro = new ResizeObserver(([e]) => setBoxW(Math.floor(e.contentRect.width)))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  const LABEL_W = 32
  const CELL = boxW ? Math.max(10, Math.min(26, Math.floor((boxW - LABEL_W - (weeks.length - 1) * GAP) / weeks.length))) : 12

  return (
    <div ref={box} className="theme-scroll overflow-x-auto pb-1">
      <div className="inline-block min-w-max">
        <div className="relative ml-8 h-4" style={{ width: weeks.length * (CELL + GAP) }}>
          {months.map((m, i) => (
            <span key={i} className="absolute top-0 text-[11px] text-muted" style={{ left: m.week * (CELL + GAP) }}>
              {m.label}
            </span>
          ))}
        </div>
        <div className="flex">
          <div className="mr-2 grid w-6 text-right text-[10.5px] text-muted" style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, gap: GAP }}>
            {DAYS.map((d, i) => (
              <span key={i} className="flex items-center justify-end leading-none">
                {d}
              </span>
            ))}
          </div>
          <div className="grid" style={{ gridAutoFlow: 'column', gridTemplateRows: `repeat(7, ${CELL}px)`, gridAutoColumns: `${CELL}px`, gap: GAP }}>
            {weeks.flat().map((c) =>
              c.n < 0 ? (
                <span key={c.iso} />
              ) : (
                <span
                  key={c.iso}
                  title={c.future ? fmtDay(c.iso) : `${c.n} commit${c.n > 1 ? 's' : ''} — ${fmtDay(c.iso)}`}
                  className="rounded-[3px]"
                  style={{ backgroundColor: levelColor(level(c.n, max)), opacity: c.future ? 0.35 : 1 }}
                />
              ),
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-muted">
          Moins
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="h-[11px] w-[11px] rounded-[3px]" style={{ backgroundColor: levelColor(l) }} />
          ))}
          Plus
        </div>
      </div>
    </div>
  )
}

// The full commit history (it used to be a tab of its own): filters on top, pages at the bottom.
const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const PER_PAGE = 20

function pageList(page, pages) {
  const set = new Set([1, pages, page - 1, page, page + 1])
  const list = [...set].filter((n) => n >= 1 && n <= pages).sort((x, y) => x - y)
  const out = []
  list.forEach((n, i) => {
    if (i && n - list[i - 1] > 1) out.push('…')
    out.push(n)
  })
  return out
}

function Pager({ page, pages, onPage }) {
  const box = 'flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-[12.5px] transition-colors'
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-center gap-1.5" aria-label="Pagination">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={`${box} border-border text-muted enabled:cursor-pointer enabled:hover:border-border-strong enabled:hover:text-text disabled:opacity-40`}>
        ‹ Précédent
      </button>
      {pageList(page, pages).map((n, i) =>
        n === '…' ? (
          <span key={`gap${i}`} className="px-1 text-muted">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onPage(n)}
            aria-current={n === page ? 'page' : undefined}
            className={`${box} cursor-pointer tabular-nums ${n === page ? 'border-accent bg-accent-bg text-accent' : 'border-border text-muted hover:border-border-strong hover:text-text'}`}
          >
            {n}
          </button>
        ),
      )}
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className={`${box} border-border text-muted enabled:cursor-pointer enabled:hover:border-border-strong enabled:hover:text-text disabled:opacity-40`}>
        Suivant ›
      </button>
    </nav>
  )
}

function History({ repo, refreshSignal }) {
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [author, setAuthor] = useState('')
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  const [view, setView] = useState('list') // list | chart
  // Lists for the filters come from the first answer (they don't shrink with the filters).
  const [facets, setFacets] = useState({ authors: [], years: [] })

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    let cancelled = false
    api()
      ?.repo_history?.(repo.path, page, PER_PAGE, debounced, author, year || null, month || null)
      ?.then((r) => {
        if (cancelled || !r || r.error) return
        setData(r)
        setFacets((f) => (f.authors.length ? f : { authors: r.authors, years: r.years }))
      })
    return () => {
      cancelled = true
    }
  }, [repo.path, page, debounced, author, year, month, refreshSignal])

  const change = (setter) => (v) => {
    setter(v)
    setPage(1)
  }
  const filtered = !!(search || author || year || month)
  const field = 'rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[12.5px] text-text hover:border-border-strong focus:border-accent'

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center gap-6 border-b border-border">
        <h3 className="pb-2 text-[15px] text-text">Historique</h3>
        {[
          ['list', 'Liste'],
          ['chart', 'Graphique'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`-mb-px cursor-pointer border-b-2 px-0.5 pb-2 text-[13px] ${view === id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'chart' && <ActivityChart repo={repo} refreshSignal={refreshSignal} />}

      {view === 'list' && (
        <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Message, auteur ou hash"
          className={`${field} w-56 outline-none placeholder:text-muted`}
        />
        <div className="w-36">
          <Select value={year} onChange={change(setYear)} className={field} title="Année" options={[{ value: '', label: 'Toutes les années' }, ...facets.years.map((y) => ({ value: String(y), label: String(y) }))]} />
        </div>
        <div className="w-36">
          <Select value={month} onChange={change(setMonth)} className={field} title="Mois" options={[{ value: '', label: 'Tous les mois' }, ...MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }))]} />
        </div>
        {facets.authors.length > 1 && (
          <div className="w-44">
            <Select value={author} onChange={change(setAuthor)} className={field} title="Auteur" options={[{ value: '', label: 'Tous les auteurs' }, ...facets.authors.map((a) => ({ value: a, label: a }))]} />
          </div>
        )}
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setAuthor('')
              setYear('')
              setMonth('')
              setPage(1)
            }}
            className="cursor-pointer text-[12px] text-muted hover:text-text"
          >
            Réinitialiser
          </button>
        )}
        {data && (
          <span className="ml-auto text-[12px] tabular-nums text-muted">
            {data.total.toLocaleString('fr-FR')} commit{data.total > 1 ? 's' : ''}
            {filtered && data.total !== data.all ? ` sur ${data.all.toLocaleString('fr-FR')}` : ''}
          </span>
        )}
      </div>

      {!data && <p className="py-3 text-[12.5px] text-muted">Chargement…</p>}
      {data && data.commits.length === 0 && <EmptyState title="Aucun commit">Aucun commit ne correspond à ces filtres. Essaie une autre période ou « Réinitialiser ».</EmptyState>}
      <ul className="divide-y divide-border/60 border-y border-border/60">
        {data?.commits.map((c) => (
          <li key={c.hash} className="flex items-baseline gap-3 py-2">
            <span className="shrink-0 font-mono text-[11.5px] text-accent">{c.short}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-text" title={c.subject}>
              {c.subject}
            </span>
            <span className="hidden shrink-0 text-[12px] text-muted sm:block">{c.author}</span>
            <span className="shrink-0 text-[12px] tabular-nums text-muted">{new Date(c.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </li>
        ))}
      </ul>
      {data && data.pages > 1 && <Pager page={data.page} pages={data.pages} onPage={setPage} />}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-text">{value}</span>
    </div>
  )
}

export function OverviewPanel({ repo, onNotify, onRefreshList, refreshSignal }) {
  const [year, setYear] = useState(null)
  const [mine, setMine] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api()
      ?.repo_overview?.(repo.path, year, mine)
      ?.then((r) => {
        if (cancelled) return
        if (r?.error) setError(r.error)
        else {
          setError(null)
          setData(r)
        }
      })
    return () => {
      cancelled = true
    }
  }, [repo.path, year, mine, refreshSignal])

  const folderName = repo.path.split(/[\\/]/).filter(Boolean).pop()

  return (
    <div className="grid gap-x-12 gap-y-8 pt-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* ------------------------------------------------ identity */}
      <aside className="min-w-0">
        <EditableIcon
          icon={repo.icon}
          fallback={<IconFolder className="h-20 w-20" />}
          className="h-52 w-52 rounded-[2rem]"
          title="Changer l'icône du projet"
          onChange={async (img) => {
            const r = await api()?.set_repo_icon?.(repo.path, img)
            if (r?.error) onNotify?.(r.error, true)
            else onRefreshList?.()
          }}
          onError={(m) => onNotify?.(m, true)}
        />
        <h2 className="mt-4 truncate text-2xl font-semibold text-text" title={repo.name}>
          {repo.name}
        </h2>
        <p className="truncate font-mono text-[12px] text-muted" title={repo.path}>
          {folderName}
        </p>
        {repo.status?.branch && (
          <p className="mt-3 flex items-center gap-1.5 font-mono text-[12px] text-muted">
            <IconBranch className="h-3.5 w-3.5" />
            {repo.status.branch}
          </p>
        )}

        {data && (
          <>
            <div className="mt-5 divide-y divide-border/60 border-y border-border/60">
              <Stat label="Commits" value={data.commits.toLocaleString('fr-FR')} />
              <Stat label="Branches" value={data.branches} />
              <Stat label="Contributeurs" value={data.contributors.length || '—'} />
              <Stat label="Dernier commit" value={data.last_commit || '—'} />
            </div>

            {data.languages.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Langages</h3>
                <div className="flex h-2 overflow-hidden rounded-full bg-surface-hover">
                  {data.languages.map((l) => (
                    <span key={l.name} title={`${l.name} ${l.percent}%`} style={{ width: `${Math.max(l.percent, 1)}%`, backgroundColor: LANG_COLOR[l.name] || '#8b8b93' }} />
                  ))}
                </div>
                <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                  {data.languages.map((l) => (
                    <li key={l.name} className="flex items-center gap-1.5 text-[12px] text-text">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: LANG_COLOR[l.name] || '#8b8b93' }} />
                      {l.name}
                      <span className="text-muted">{l.percent}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.contributors.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Contributeurs</h3>
                {data.contributors.map((c) => (
                  <div key={c.name} className="flex items-center gap-2 py-1 text-[12.5px]">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[10px] font-semibold uppercase text-accent">{c.name.slice(0, 1)}</span>
                    <span className="min-w-0 flex-1 truncate text-text">{c.name}</span>
                    <span className="tabular-nums text-muted">{c.commits}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </aside>

      {/* ------------------------------------------------ activity */}
      <section className="min-w-0">
        {error && <EmptyState title="Aperçu indisponible">{error}</EmptyState>}
        {!error && !data && <p className="py-10 text-center text-[13px] text-muted">Analyse de l'historique…</p>}
        {data && !error && (
          <div className="flex gap-8">
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <h3 className="text-[15px] text-text">
                  <span className="font-semibold tabular-nums">{data.total.toLocaleString('fr-FR')}</span> commit{data.total > 1 ? 's' : ''} {data.year ? `en ${data.year}` : "sur l'année écoulée"}
                </h3>
                <div className="ml-auto flex items-center gap-1 rounded-md bg-surface-hover/50 p-0.5 text-[12px]">
                  {[
                    [false, 'Tous'],
                    [true, 'Moi'],
                  ].map(([v, label]) => (
                    <button key={label} type="button" onClick={() => setMine(v)} className={`cursor-pointer rounded px-2.5 py-0.5 ${mine === v ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-border px-4 py-3">
                <Heatmap data={data} />
              </div>

              <History repo={repo} refreshSignal={refreshSignal} />
            </div>

            {/* years, like GitHub's column on the right */}
            {data.years.length > 0 && (
              <div className="hidden w-24 shrink-0 flex-col gap-1.5 md:flex">
                <button type="button" onClick={() => setYear(null)} className={`cursor-pointer rounded-md px-3 py-2 text-left text-[13px] ${year === null ? 'bg-accent text-white' : 'text-muted hover:bg-surface-hover hover:text-text'}`}>
                  12 mois
                </button>
                {data.years.map((y) => (
                  <button key={y} type="button" onClick={() => setYear(y)} className={`cursor-pointer rounded-md px-3 py-2 text-left text-[13px] ${year === y ? 'bg-accent text-white' : 'text-muted hover:bg-surface-hover hover:text-text'}`}>
                    {y}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

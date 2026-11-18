import { useEffect, useMemo, useRef, useState } from 'react'
import { FileTypeIcon } from './fileIcons'

// Search in the whole project (Ctrl+Shift+F), in the Code tab's side panel.
// Results are grouped by file; a click opens the file on that line.

function api() {
  return window.pywebview?.api
}

function Toggle({ on, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-6 min-w-6 cursor-pointer items-center justify-center rounded px-1 font-mono text-[11px] transition-colors ${
        on ? 'bg-accent-bg text-accent ring-1 ring-accent/50' : 'text-muted hover:bg-surface-hover hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

// The matched text, highlighted inside its line (the line is trimmed to keep
// the match visible when it sits far to the right).
function Snippet({ text, col, len }) {
  const start = Math.max(0, col - 28)
  const lead = start > 0 ? '…' : ''
  const before = text.slice(start, col)
  const hit = text.slice(col, col + len)
  const after = text.slice(col + len, col + len + 90)
  return (
    <span className="truncate font-mono text-[11.5px] text-muted">
      {lead}
      {before.trimStart()}
      <mark className="rounded-sm bg-accent/25 px-px text-text">{hit}</mark>
      {after}
    </span>
  )
}

export default function ProjectSearch({ repoPath, initialQuery, focusSignal, onOpen }) {
  const [query, setQuery] = useState(initialQuery || '')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [glob, setGlob] = useState('')
  const [showFilter, setShowFilter] = useState(false)
  const [state, setState] = useState({ status: 'idle', results: [], count: 0, truncated: false, error: '' })
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [cursor, setCursor] = useState(null) // "file:line" of the keyboard-selected hit
  const inputRef = useRef(null)
  const seq = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSignal])

  // Debounced: every keystroke would otherwise walk the whole project.
  useEffect(() => {
    const q = query
    if (!q.trim()) {
      setState({ status: 'idle', results: [], count: 0, truncated: false, error: '' })
      return undefined
    }
    const id = setTimeout(async () => {
      const mine = ++seq.current
      setState((s) => ({ ...s, status: 'loading', error: '' }))
      let r
      try {
        r = await api()?.search_in_repo?.(repoPath, q, caseSensitive, regex, glob)
      } catch (e) {
        r = { error: String(e) }
      }
      if (mine !== seq.current) return // a newer search is already running
      if (!r || r.error) {
        setState({ status: 'error', results: [], count: 0, truncated: false, error: r?.error || 'Recherche impossible' })
        return
      }
      setCollapsed(new Set())
      setState({ status: 'done', results: r.results || [], count: r.count || 0, truncated: !!r.truncated, error: '' })
    }, 280)
    return () => clearTimeout(id)
  }, [query, caseSensitive, regex, glob, repoPath])

  const flat = useMemo(
    () =>
      state.results.flatMap((g) =>
        collapsed.has(g.file) ? [] : g.matches.map((m) => ({ file: g.file, ...m, key: `${g.file}:${m.line}:${m.col}` })),
      ),
    [state.results, collapsed],
  )

  function open(hit) {
    setCursor(hit.key)
    onOpen(hit.file, hit.line, hit.match)
  }

  function onKeyDown(e) {
    if (!flat.length) return
    const i = flat.findIndex((h) => h.key === cursor)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = e.key === 'ArrowDown' ? Math.min(flat.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1)
      setCursor(flat[next].key)
      document.getElementById(`ps-${flat[next].key}`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      open(flat[i < 0 ? 0 : i])
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1.5 border-b border-border p-2">
        <div className="flex items-center gap-1 rounded-md border border-border bg-base px-2 focus-within:border-accent">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Rechercher dans le projet"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12.5px] text-text outline-none placeholder:text-muted/60"
          />
          <Toggle on={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} title="Respecter la casse">
            Aa
          </Toggle>
          <Toggle on={regex} onClick={() => setRegex((v) => !v)} title="Expression régulière">
            .*
          </Toggle>
          <Toggle
            on={showFilter || !!glob}
            onClick={() => setShowFilter((v) => !v)}
            title="Limiter la recherche à certains fichiers (ex. *.js, src/*.py)"
          >
            ⋯
          </Toggle>
        </div>
        {(showFilter || glob) && (
        <input
          value={glob}
          onChange={(e) => setGlob(e.target.value)}
          placeholder="Chercher seulement dans : *.js, src/*.py"
          spellCheck={false}
          className="rounded-md border border-border bg-base px-2 py-1 font-mono text-[11px] text-text outline-none placeholder:text-muted/60 focus:border-accent"
        />
        )}
      </div>

      <div className="theme-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        {state.status === 'idle' && <p className="px-3 py-4 text-[12px] text-muted">Tape pour chercher dans tous les fichiers du projet.</p>}
        {state.status === 'loading' && state.results.length === 0 && <p className="px-3 py-4 text-[12px] text-muted">Recherche…</p>}
        {state.status === 'error' && <p className="px-3 py-4 text-[12px] text-danger">{state.error}</p>}
        {state.status === 'done' && state.count === 0 && <p className="px-3 py-4 text-[12px] text-muted">Aucun résultat.</p>}
        {state.count > 0 && (
          <p className="px-3 py-1.5 text-[11px] text-muted">
            {state.count}
            {state.truncated ? '+' : ''} résultat{state.count > 1 ? 's' : ''} dans {state.results.length} fichier{state.results.length > 1 ? 's' : ''}
            {state.truncated && ' — affine ta recherche'}
          </p>
        )}
        {state.results.map((g) => {
          const shut = collapsed.has(g.file)
          const name = g.file.split('/').pop()
          const dir = g.file.slice(0, g.file.length - name.length).replace(/\/$/, '')
          return (
            <div key={g.file}>
              <button
                type="button"
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev)
                    if (next.has(g.file)) next.delete(g.file)
                    else next.add(g.file)
                    return next
                  })
                }
                className="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover"
                title={g.file}
              >
                <span className={`text-[9px] text-muted transition-transform ${shut ? '' : 'rotate-90'}`}>▶</span>
                <FileTypeIcon name={name} className="h-4 w-4 shrink-0" />
                <span className="truncate text-[12px] font-medium text-text">{name}</span>
                {dir && <span className="truncate text-[11px] text-muted/70">{dir}</span>}
                <span className="ml-auto shrink-0 rounded-full bg-surface-hover px-1.5 text-[10px] text-muted">{g.matches.length}</span>
              </button>
              {!shut &&
                g.matches.map((m) => {
                  const key = `${g.file}:${m.line}:${m.col}`
                  return (
                    <button
                      key={key}
                      id={`ps-${key}`}
                      type="button"
                      onClick={() => open({ file: g.file, ...m, key })}
                      className={`flex w-full cursor-pointer items-baseline gap-2 py-0.5 pl-7 pr-2 text-left transition-colors hover:bg-surface-hover ${
                        cursor === key ? 'bg-accent-bg' : ''
                      }`}
                    >
                      <span className="w-8 shrink-0 text-right font-mono text-[10.5px] text-muted/60">{m.line}</span>
                      <Snippet text={m.text} col={m.col} len={m.match.length} />
                    </button>
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { IconCheck, IconClose, IconPlay, IconPlus, IconTrash, IconTerminal, IconFolder } from './icons'

function api() {
  return window.pywebview?.api
}

function timeAgo(seconds) {
  if (!seconds) return ''
  const diff = Math.max(0, Date.now() / 1000 - seconds)
  if (diff < 60) return "à l'instant"
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`
  if (diff < 86400 * 7) return `il y a ${Math.floor(diff / 86400)} j`
  return new Date(seconds * 1000).toLocaleDateString()
}

function SessionPicker({ project, onPick, onClose }) {
  const [sessions, setSessions] = useState(null)
  useEffect(() => {
    api()
      ?.list_claude_sessions?.(project)
      ?.then((list) => setSessions(Array.isArray(list) ? list : []))
  }, [project])
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-base">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted">Sessions Claude du projet</span>
        <button onClick={onClose} className="cursor-pointer text-muted hover:text-text" title="Fermer">
          <IconClose className="h-3 w-3" />
        </button>
      </div>
      {sessions === null && <p className="px-3 py-2 text-[11px] text-muted">Chargement…</p>}
      {sessions?.length === 0 && <p className="px-3 py-2 text-[11px] text-muted">Aucune session pour ce projet.</p>}
      {sessions?.slice(0, 8).map((s) => (
        <button
          key={s.id}
          onClick={() => onPick(s.id)}
          className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-text hover:bg-surface-hover"
        >
          <IconTerminal className="h-3 w-3 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{s.title}</span>
          <span className="shrink-0 text-[10.5px] text-muted">{timeAgo(s.modified)}</span>
        </button>
      ))}
    </div>
  )
}

function TaskRow({ task, showProject, projectName, repos, onToggle, onDelete, onSetProject, onLaunch }) {
  const [picking, setPicking] = useState(false)
  const done = !!task.done
  return (
    <li
      className={`group rounded-xl border px-3.5 py-3 transition-colors ${
        done ? 'border-transparent bg-transparent' : 'border-border bg-base hover:border-border-strong'
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          title={done ? 'Marquer à faire' : 'Marquer terminée'}
          className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full border-[1.5px] transition-all ${
            done ? 'border-accent bg-accent text-white' : 'border-muted/60 text-transparent hover:border-accent hover:text-accent/60'
          }`}
        >
          <IconCheck className="h-2.5 w-2.5" />
        </button>

        <div className="min-w-0 flex-1">
          <p className={`break-words text-[13px] leading-snug ${done ? 'text-muted line-through decoration-muted/50' : 'text-text'}`}>
            {task.text}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted">
            {showProject && task.project && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-bg px-2 py-0.5 font-medium text-accent">
                <IconFolder className="h-2.5 w-2.5" />
                {projectName(task.project)}
              </span>
            )}
            {!task.project && !done && (
              <label className="relative inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-border-strong px-2 py-0.5 hover:border-accent hover:text-text">
                <IconPlus className="h-2.5 w-2.5" />
                Rattacher à un projet
                {/* Invisible select over the chip: the click opens the native list. */}
                <select
                  value=""
                  onChange={(e) => e.target.value && onSetProject(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                >
                  <option value="">—</option>
                  {repos.map((r) => (
                    <option key={r.path} value={r.path}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span>{timeAgo(task.created_at)}</span>
            {!done && task.project && (
              <span className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => onLaunch(task, null)}
                  title="Nouvelle session Claude qui exécute cette tâche"
                  className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-white shadow-sm transition-opacity hover:opacity-90"
                >
                  <IconPlay className="h-2.5 w-2.5" />
                  Lancer avec Claude
                </button>
                <button
                  onClick={() => setPicking((v) => !v)}
                  title="Envoyer dans une session existante du projet"
                  className={`cursor-pointer whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                    picking ? 'border-accent text-accent' : 'border-border text-muted hover:border-border-strong hover:text-text'
                  }`}
                >
                  Reprendre une session
                </button>
              </span>
            )}
          </div>
        </div>

        <button
          onClick={onDelete}
          title="Supprimer"
          className="-mt-0.5 shrink-0 cursor-pointer rounded-lg p-1.5 text-muted opacity-0 transition-opacity hover:bg-danger-bg hover:text-danger group-hover:opacity-100"
        >
          <IconTrash className="h-3.5 w-3.5" />
        </button>
      </div>
      {picking && (
        <SessionPicker
          project={task.project}
          onPick={(id) => {
            setPicking(false)
            onLaunch(task, id)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </li>
  )
}

const ALL = '__all__'
const GENERAL = '__general__'

export function HubiTasksModal({ repos, onClose, onNotify, onLaunch }) {
  const [tasks, setTasks] = useState(null)
  const [text, setText] = useState('')
  const [scope, setScope] = useState(ALL)
  const [filter, setFilter] = useState('todo')
  const [target, setTarget] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    api()
      ?.hubi_tasks_list?.()
      ?.then((r) => setTasks(r?.tasks || []))
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // New tasks go to the project being looked at.
  useEffect(() => {
    setTarget(scope === ALL || scope === GENERAL ? '' : scope)
  }, [scope])

  async function run(promise) {
    const r = await promise
    if (r?.error) onNotify(r.error, true)
    if (r?.tasks) setTasks(r.tasks)
    return r
  }

  async function add() {
    if (!text.trim()) return
    const r = await run(api()?.hubi_task_add?.(text.trim(), target || null))
    if (!r?.error) {
      setText('')
      setFilter((f) => (f === 'done' ? 'todo' : f))
      inputRef.current?.focus()
    }
  }

  const projectName = (path) => repos.find((r) => r.path === path)?.name || path.split(/[\\/]/).filter(Boolean).pop() || path

  const all = tasks || []
  const scopes = useMemo(() => {
    const open = (list) => list.filter((t) => !t.done).length
    const projects = new Map()
    for (const t of all) if (t.project) projects.set(t.project, [...(projects.get(t.project) || []), t])
    return [
      { id: ALL, label: 'Toutes', open: open(all) },
      { id: GENERAL, label: 'Générales', open: open(all.filter((t) => !t.project)) },
      ...[...projects.entries()]
        .map(([path, list]) => ({ id: path, label: projectName(path), open: open(list), project: true }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, repos])

  const inScope = all.filter((t) => (scope === ALL ? true : scope === GENERAL ? !t.project : t.project === scope))
  const doneCount = inScope.filter((t) => t.done).length
  const visible = inScope
    .filter((t) => (filter === 'todo' ? !t.done : filter === 'done' ? t.done : true))
    .sort((a, b) => Number(a.done) - Number(b.done) || b.created_at - a.created_at)
  const progress = inScope.length ? Math.round((doneCount / inScope.length) * 100) : 0
  const scopeLabel = scopes.find((s) => s.id === scope)?.label || projectName(scope)

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-6 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="flex h-[min(640px,85vh)] w-full max-w-4xl overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar: scopes */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-base/40">
          <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
            <img src="/hubi/hubi-icon.png" alt="" className="h-5 w-7 object-contain" />
            <span className="text-sm font-semibold">Tâches</span>
          </div>
          <nav className="theme-scroll flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {scopes.map((s, i) => (
              <div key={s.id}>
                {i === 2 && <p className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70">Projets</p>}
                <button
                  onClick={() => setScope(s.id)}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                    scope === s.id ? 'bg-surface-hover text-text' : 'text-muted hover:bg-surface-hover/60 hover:text-text'
                  }`}
                >
                  {s.project ? (
                    <IconFolder className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${scope === s.id ? 'bg-accent' : 'bg-muted/50'}`} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {s.open > 0 && (
                    <span
                      className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                        scope === s.id ? 'bg-accent text-white' : 'bg-surface-hover text-muted'
                      }`}
                    >
                      {s.open}
                    </span>
                  )}
                </button>
              </div>
            ))}
          </nav>
          <div className="border-t border-border px-4 py-3 text-[10.5px] leading-relaxed text-muted">
            <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px] text-text">Ctrl+Alt+H</kbd> ajoute une tâche
            de n'importe où. Commence par <span className="font-mono text-accent">@projet</span> pour la ranger.
          </div>
        </aside>

        {/* Main */}
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between gap-4 px-6 pt-5">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-tight">{scopeLabel}</h2>
              <p className="mt-0.5 text-[11.5px] text-muted">
                {inScope.length === 0
                  ? 'Aucune tâche'
                  : `${inScope.length - doneCount} à faire · ${doneCount} terminée${doneCount > 1 ? 's' : ''}`}
              </p>
            </div>
            <button onClick={onClose} className="mt-1 cursor-pointer rounded-lg p-1 text-muted hover:bg-surface-hover hover:text-text" title="Fermer (Échap)">
              <IconClose className="h-4 w-4" />
            </button>
          </header>

          {inScope.length > 0 && (
            <div className="mx-6 mt-3 h-1 overflow-hidden rounded-full bg-surface-hover">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Composer */}
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-xl border border-border bg-base px-3 py-2 transition-colors focus-within:border-accent">
            <IconPlus className="h-4 w-4 shrink-0 text-muted" />
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Ajouter une tâche…"
              maxLength={300}
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-muted"
            />
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              title="Projet de la tâche"
              className="max-w-[10rem] cursor-pointer rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-muted outline-none hover:text-text"
            >
              <option value="">Générale</option>
              {repos.map((r) => (
                <option key={r.path} value={r.path}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              onClick={add}
              disabled={!text.trim()}
              className="cursor-pointer rounded-lg bg-accent px-3 py-1 text-[11.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Ajouter
            </button>
          </div>

          {/* Filter */}
          <div className="mx-6 mt-4 flex items-center gap-1 border-b border-border">
            {[
              { id: 'todo', label: 'À faire', n: inScope.length - doneCount },
              { id: 'done', label: 'Terminées', n: doneCount },
              { id: 'all', label: 'Tout', n: inScope.length },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-2.5 pb-2 text-[12px] transition-colors ${
                  filter === f.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {f.label}
                <span className="text-[10.5px] tabular-nums text-muted">{f.n}</span>
              </button>
            ))}
          </div>

          <div className="theme-scroll flex-1 overflow-y-auto px-6 py-4">
            {tasks === null ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-hover/60" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 pb-6 text-center">
                <img
                  src="/hubi/hubi-icon.png"
                  alt=""
                  className={`h-16 w-20 object-contain drop-shadow-lg ${filter === 'done' ? '' : 'opacity-70 grayscale'}`}
                />
                <p className="text-sm font-medium text-text">
                  {filter === 'done' ? 'Rien de terminé pour le moment' : 'Rien à faire ici'}
                </p>
                <p className="max-w-xs text-[11.5px] text-muted">
                  {filter === 'done'
                    ? 'Les tâches cochées apparaîtront ici.'
                    : 'Hubi se repose. Ajoute une tâche au-dessus, ou depuis n’importe où avec Ctrl+Alt+H.'}
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {visible.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    showProject={scope === ALL}
                    projectName={projectName}
                    repos={repos}
                    onToggle={() => run(api()?.hubi_task_toggle?.(t.id))}
                    onDelete={() => run(api()?.hubi_task_delete?.(t.id))}
                    onSetProject={(path) => run(api()?.hubi_task_set_project?.(t.id, path))}
                    onLaunch={onLaunch}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

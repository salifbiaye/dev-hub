import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SessionPicker } from './hubiTasks'
import { EmptyState } from './emptyState'

// The "Tâches" tab: this project's Hubi tasks (the same list as the Ctrl+Alt+H bar and
// the Hubi tasks window), the TODO / FIXME comments found in the code, and free notes.
// Notes live in Dev Hub's data folder (per project), never in the repo.
//
// Flat on purpose: hairlines and whitespace instead of boxed cards.

function api() {
  return window.pywebview?.api
}

const KIND_TONE = {
  FIXME: 'text-danger',
  BUG: 'text-danger',
  HACK: 'text-warning',
  XXX: 'text-warning',
  TODO: 'text-muted',
}

function Heading({ children, count, right }) {
  return (
    <div className="flex items-baseline gap-2 px-1 pb-2">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{children}</h3>
      {count != null && <span className="text-[11px] tabular-nums text-muted/70">{count}</span>}
      <div className="ml-auto flex items-center gap-3 text-[11.5px] text-muted">{right}</div>
    </div>
  )
}

function Check({ done, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`mt-[3px] flex h-[15px] w-[15px] shrink-0 cursor-pointer items-center justify-center rounded-full border text-[8px] transition-colors ${
        done ? 'border-accent bg-accent text-white' : 'border-muted/50 text-transparent hover:border-accent hover:text-accent'
      }`}
    >
      ✓
    </button>
  )
}

export function TasksPanel({ repo, onNotify, onOpenFile, onAskAi, onLaunch }) {
  const [data, setData] = useState(null) // { tasks (legacy, migrated to Hubi), notes }
  const [hubiTasks, setHubiTasks] = useState(null) // every Hubi task; filtered below
  const [draft, setDraft] = useState('')
  const [todos, setTodos] = useState(null) // { items, truncated } | { error }
  const [scanning, setScanning] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [showLoose, setShowLoose] = useState(false)
  const [picking, setPicking] = useState(null) // id of the task choosing a session to resume
  const [cliLabel, setCliLabel] = useState('Claude') // Claude Code or Codex, from Paramètres IA
  const saveTimer = useRef(null)
  const latest = useRef(null)

  const refreshTasks = useCallback(() => {
    api()
      ?.hubi_tasks_list?.()
      ?.then((r) => r && setHubiTasks(r.tasks || []))
  }, [])

  useEffect(() => {
    let cancelled = false
    api()
      ?.tasks_load?.(repo.path)
      .then(async (d) => {
        if (cancelled) return
        const loaded = d || { tasks: [], notes: '' }
        // Tasks kept here by an earlier version now live in Hubi's list.
        if (loaded.tasks?.length) {
          for (const t of loaded.tasks.filter((x) => !x.done).reverse()) await api()?.hubi_task_add?.(t.title, repo.path)
          loaded.tasks = []
          api()?.tasks_save?.(repo.path, loaded)
        }
        if (!cancelled) setData(loaded)
      })
    api()
      ?.get_ai_cli?.()
      ?.then((r) => !cancelled && r?.label && setCliLabel(r.label))
    refreshTasks()
    // Tasks are also added from the Ctrl+Alt+H bar, outside this window.
    window.addEventListener('focus', refreshTasks)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshTasks)
    }
  }, [repo.path, refreshTasks])

  const scan = useCallback(async () => {
    setScanning(true)
    const r = await api()?.tasks_scan_todos?.(repo.path)
    setScanning(false)
    setTodos(r || { error: 'Pas de réponse du backend' })
  }, [repo.path])

  useEffect(() => {
    scan()
  }, [scan])

  const persist = useCallback(
    (next) => {
      latest.current = next
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => api()?.tasks_save?.(repo.path, latest.current), 400)
    },
    [repo.path],
  )
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        if (latest.current) api()?.tasks_save?.(repo.path, latest.current)
      }
    },
    [repo.path],
  )

  async function hubi(promise) {
    const r = await promise
    if (r?.error) onNotify?.(r.error, true)
    if (r?.tasks) setHubiTasks(r.tasks)
    return r
  }

  const addTask = (title) => title.trim() && hubi(api()?.hubi_task_add?.(title.trim(), repo.path))
  const toggle = (id) => hubi(api()?.hubi_task_toggle?.(id))
  const removeTask = (id) => hubi(api()?.hubi_task_delete?.(id))

  function askAiTask(t) {
    onAskAi?.(`Tâche à réaliser dans ce projet : ${t.text}\n\nFais-la, puis résume ce que tu as changé.`)
  }

  function askAiTodo(h) {
    onAskAi?.(`Il y a un ${h.kind} dans le code : ${h.file}:${h.line}${h.text ? ` — « ${h.text} »` : ''}\n\nRegarde le contexte, fais ce qui est demandé et retire le commentaire une fois réglé.`)
  }

  const mine = useMemo(() => (hubiTasks || []).filter((t) => t.project === repo.path), [hubiTasks, repo.path])
  // The code list, grouped by file so a cluttered file reads as one block.
  const byFile = useMemo(() => {
    const map = new Map()
    for (const h of todos?.items || []) map.set(h.file, [...(map.get(h.file) || []), h])
    return [...map.entries()]
  }, [todos])

  if (!data || !hubiTasks) return <div className="py-10 text-center text-[13px] text-muted">Chargement…</div>

  const open = mine.filter((t) => !t.done)
  const done = mine.filter((t) => t.done)
  // Hubi tasks noted without a project (Ctrl+Alt+H without @projet): one click attaches them here.
  const loose = hubiTasks.filter((t) => !t.project && !t.done)
  const items = todos?.items || []

  return (
    <div className="grid gap-x-10 gap-y-10 pt-2 @container xl:min-h-[calc(100vh-14rem)] xl:grid-cols-2">
      {/* ------------------------------------------------ tasks + notes */}
      <div className="flex min-w-0 flex-col gap-10">
        <section>
          <Heading
            count={open.length || null}
            right={
              <span>
                <kbd className="rounded bg-surface-hover px-1.5 py-px font-mono text-[10px] text-text">Ctrl+Alt+H</kbd> depuis n'importe où
              </span>
            }
          >
            Tâches
          </Heading>
          <div className="flex items-center gap-3 rounded-md px-1 py-2 text-muted focus-within:bg-surface-hover/50 focus-within:text-text">
            <span className="flex h-[15px] w-[15px] shrink-0 items-center justify-center text-[15px] leading-none">+</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addTask(draft)
                  setDraft('')
                }
              }}
              placeholder="Nouvelle tâche"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-text outline-none placeholder:text-muted"
            />
          </div>
          <ul className="divide-y divide-border/60">
            {open.map((t) => (
              <li key={t.id} className="group rounded-md px-1 py-2 hover:bg-surface-hover/40">
                <div className="flex items-start gap-3">
                  <Check done={false} onClick={() => toggle(t.id)} title="Terminée" />
                  <span className="min-w-0 flex-1 break-words text-[13.5px] leading-snug text-text">{t.text}</span>
                  <span className={`${picking === t.id ? 'flex' : 'hidden group-hover:flex'} shrink-0 items-center gap-2.5 text-[11.5px]`}>
                    {onLaunch && (
                      <>
                        <button type="button" onClick={() => onLaunch(t.text, null)} className="cursor-pointer whitespace-nowrap text-accent hover:underline" title={`Nouvelle session ${cliLabel} qui exécute cette tâche`}>
                          Lancer avec {cliLabel}
                        </button>
                        <button type="button" onClick={() => setPicking((v) => (v === t.id ? null : t.id))} className={`cursor-pointer whitespace-nowrap hover:text-text ${picking === t.id ? 'text-text' : 'text-muted'}`} title="Envoyer dans une session existante du projet">
                          Reprendre une session
                        </button>
                      </>
                    )}
                    <button type="button" onClick={() => removeTask(t.id)} className="cursor-pointer text-muted hover:text-danger" title="Supprimer">
                      ✕
                    </button>
                  </span>
                </div>
                {picking === t.id && (
                  <SessionPicker
                    project={repo.path}
                    cliLabel={cliLabel}
                    onPick={(id) => {
                      setPicking(null)
                      onLaunch?.(t.text, id)
                    }}
                    onClose={() => setPicking(null)}
                  />
                )}
              </li>
            ))}
          </ul>
          {open.length === 0 && <p className="px-1 py-3 text-[12.5px] text-muted">Rien à faire pour ce projet.</p>}
          {done.length > 0 && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowDone((v) => !v)} className="flex cursor-pointer items-center gap-1.5 px-1 py-1.5 text-[12px] text-muted hover:text-text">
                <span className={`text-[8px] transition-transform ${showDone ? 'rotate-90' : ''}`}>▶</span>
                {done.length} terminée{done.length > 1 ? 's' : ''}
              </button>
              {showDone && (
                <>
                  {done.map((t) => (
                    <div key={t.id} className="group flex items-start gap-3 px-1 py-1.5">
                      <Check done onClick={() => toggle(t.id)} title="Rouvrir" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted line-through decoration-muted/40">{t.text}</span>
                      <button type="button" onClick={() => removeTask(t.id)} className="hidden cursor-pointer text-[11.5px] text-muted hover:text-danger group-hover:block">
                        ✕
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => done.forEach((t) => removeTask(t.id))} className="cursor-pointer px-1 py-1 text-[11.5px] text-muted hover:text-danger">
                    Vider les terminées
                  </button>
                </>
              )}
            </div>
          )}
          {loose.length > 0 && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowLoose((v) => !v)} className="flex cursor-pointer items-center gap-1.5 px-1 py-1.5 text-[12px] text-muted hover:text-text">
                <span className={`text-[8px] transition-transform ${showLoose ? 'rotate-90' : ''}`}>▶</span>
                {loose.length} sans projet
              </button>
              {showLoose &&
                loose.map((t) => (
                  <div key={t.id} className="group flex items-start gap-3 rounded-md px-1 py-1.5 hover:bg-surface-hover/40">
                    <Check done={false} onClick={() => toggle(t.id)} title="Terminée" />
                    <span className="min-w-0 flex-1 break-words text-[13px] leading-snug text-muted">{t.text}</span>
                    <button type="button" onClick={() => hubi(api()?.hubi_task_set_project?.(t.id, repo.path))} className="hidden shrink-0 cursor-pointer text-[11.5px] text-accent hover:underline group-hover:block">
                      Rattacher ici
                    </button>
                  </div>
                ))}
            </div>
          )}
        </section>

        <section>
          <Heading right={<span>Reste dans Dev Hub, pas dans le dépôt</span>}>Notes</Heading>
          <textarea
            value={data.notes}
            onChange={(e) => {
              const next = { ...data, notes: e.target.value }
              setData(next)
              persist(next)
            }}
            spellCheck={false}
            placeholder="Décisions, commandes utiles, pièges…"
            className="theme-scroll block h-56 w-full resize-y rounded-md bg-surface-hover/30 px-3 py-2.5 text-[13.5px] leading-relaxed text-text outline-none placeholder:text-muted focus:bg-surface-hover/50"
          />
        </section>
      </div>

      {/* ------------------------------------------------ code */}
      <section className="min-w-0 xl:border-l xl:border-border xl:pl-10">
        <Heading
          count={todos?.items ? `${items.length}${todos.truncated ? '+' : ''}` : null}
          right={
            <button type="button" onClick={scan} disabled={scanning} className="cursor-pointer hover:text-text disabled:opacity-50">
              {scanning ? 'Analyse…' : 'Actualiser'}
            </button>
          }
        >
          Dans le code
        </Heading>
        {todos?.error && <p className="px-1 py-3 text-[12.5px] text-danger">{todos.error}</p>}
        {!todos && <p className="px-1 py-3 text-[12.5px] text-muted">Analyse du code…</p>}
        {todos?.items && items.length === 0 && (
          <EmptyState title="Aucun TODO dans le code">Les commentaires TODO, FIXME et HACK du projet apparaîtront ici, avec un lien vers le fichier.</EmptyState>
        )}
        <div className="theme-scroll max-h-[calc(100vh-18rem)] overflow-y-auto">
          {byFile.map(([file, hits]) => (
            <div key={file} className="mb-4">
              <p className="truncate px-1 pb-1 font-mono text-[11px] text-muted/80" title={file}>
                {file}
              </p>
              {hits.map((h) => {
                const src = `${h.file}:${h.line}`
                const tracked = mine.some((t) => t.text.includes(src))
                return (
                  <div key={src} className="group flex items-baseline gap-3 rounded-md px-1 py-1.5 hover:bg-surface-hover/40">
                    <button type="button" onClick={() => onOpenFile?.(h.file, h.line)} className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2.5 text-left" title="Ouvrir dans l'onglet Code">
                      <span className={`w-9 shrink-0 text-[10px] font-semibold tracking-wide ${KIND_TONE[h.kind] || KIND_TONE.TODO}`}>{h.kind}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-text">{h.text || <span className="text-muted">sans texte</span>}</span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">:{h.line}</span>
                    </button>
                    <span className="hidden shrink-0 items-center gap-2 text-[11.5px] group-hover:flex">
                      <button
                        type="button"
                        disabled={tracked}
                        onClick={() => {
                          addTask(`${h.text || h.kind} — ${src}`)
                          onNotify?.('Tâche ajoutée')
                        }}
                        className="cursor-pointer text-muted hover:text-text disabled:cursor-default disabled:opacity-40"
                      >
                        {tracked ? 'Suivie' : '+ Tâche'}
                      </button>
                      {onAskAi && (
                        <button type="button" onClick={() => askAiTodo(h)} className="cursor-pointer text-accent hover:underline">
                          IA
                        </button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

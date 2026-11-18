import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CodeEditor } from './codeEditor'
import { EmptyState } from './emptyState'
import { Select } from './themedSelect'
import { IconChevronDown, IconClose, IconCopy, IconEye, IconEyeOff, IconFolder, IconKey, IconMaximize, IconPencil, IconPlus, IconTrash } from './icons'

// The "Requêtes" tab: a small Postman for the project's own API. Collections (folders),
// environments and saved requests are kept per project in Dev Hub's data folder (nothing is
// written in the repo) and can be imported from / exported to Postman and Insomnia.
//
// Flat layout (sidebar + request tabs + editor split by hairlines) rather than stacked cards.

function api() {
  return window.pywebview?.api
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const METHOD_COLOR = {
  GET: 'text-success',
  POST: 'text-warning',
  PUT: 'text-accent',
  PATCH: 'text-accent',
  DELETE: 'text-danger',
}

const uid = () => Math.random().toString(36).slice(2, 10)
const emptyRow = () => ({ key: '', value: '', enabled: true })
const newRequest = (over = {}) => ({ id: uid(), name: '', method: 'GET', url: '/', params: [], headers: [], body: '', bearer: '', folder: '', ...over })
const clean = ({ _dirty, _resp, ...request }) => request // eslint-disable-line no-unused-vars
const joinPath = (...p) => p.filter(Boolean).join('/')
const parentOf = (path) => path.slice(0, Math.max(path.lastIndexOf('/'), 0))
const leafOf = (path) => path.slice(path.lastIndexOf('/') + 1)
const newEnv = (over = {}) => ({ id: uid(), name: 'Nouvel environnement', baseUrl: '', variables: [], ...over })

function statusTone(s) {
  if (!s) return ['bg-danger', 'text-danger']
  if (s < 300) return ['bg-success', 'text-success']
  if (s < 400) return ['bg-warning', 'text-warning']
  return ['bg-danger', 'text-danger']
}

function size(n) {
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`
  return `${(n / 1024 / 1024).toFixed(1)} Mo`
}

function MethodTag({ m }) {
  return <span className={`w-9 shrink-0 font-mono text-[10px] font-semibold ${METHOD_COLOR[m] || 'text-muted'}`}>{m === 'DELETE' ? 'DEL' : m === 'PATCH' ? 'PAT' : m}</span>
}

function Ghost({ children, ...p }) {
  return (
    <button type="button" {...p} className={`cursor-pointer text-[12px] text-muted transition-colors hover:text-text disabled:opacity-50 ${p.className || ''}`}>
      {children}
    </button>
  )
}

// Headers / query parameters: plain "key | value" rows with a checkbox.
function Rows({ rows, onChange, keyPlaceholder, valuePlaceholder }) {
  const list = rows.length && rows[rows.length - 1].key === '' && rows[rows.length - 1].value === '' ? rows : [...rows, emptyRow()]
  function set(i, p) {
    const next = list.map((r, j) => (j === i ? { ...r, ...p } : r))
    onChange(next.filter((r, j) => r.key !== '' || r.value !== '' || j === next.length - 1))
  }
  const field = 'min-w-0 border-b border-transparent bg-transparent px-1 py-1.5 font-mono text-[12px] text-text outline-none placeholder:text-muted/60 focus:border-accent'
  return (
    <div className="flex flex-col">
      {list.map((r, i) => (
        <div key={i} className="flex items-center gap-2 border-b border-border/50">
          <input type="checkbox" checked={r.enabled !== false} onChange={(e) => set(i, { enabled: e.target.checked })} className="accent-[var(--color-accent)]" />
          <input value={r.key} onChange={(e) => set(i, { key: e.target.value })} placeholder={keyPlaceholder} spellCheck={false} className={`${field} flex-1`} />
          <input value={r.value} onChange={(e) => set(i, { value: e.target.value })} placeholder={valuePlaceholder} spellCheck={false} className={`${field} flex-[2]`} />
        </div>
      ))}
    </div>
  )
}

// Environment variables, laid out like the project's Env tab: key, masked value, copy / reveal / delete.
function VarTable({ rows, onChange, onNotify }) {
  const [revealed, setRevealed] = useState(() => new Set())
  const set = (i, p) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const toggle = (i) =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  const input = 'rounded-md border border-transparent bg-transparent px-2 py-1.5 font-mono text-[12px] text-text outline-none hover:border-border focus:border-accent focus:bg-base'
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border bg-surface-hover px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span className="w-56 shrink-0 pl-6">Variable</span>
        <span className="flex-1">Valeur</span>
        <span className="w-20 shrink-0" />
      </div>
      <div className="divide-y divide-border">
        {rows.length === 0 && <p className="px-3 py-3 text-xs text-muted">Aucune variable. Utilise-les avec <code className="text-text">{'{{nom}}'}</code> dans l'URL, les en-têtes ou le corps.</p>}
        {rows.map((r, i) => (
          <div key={i} className={`group flex items-center gap-3 px-3 py-1.5 ${r.enabled === false ? 'opacity-50' : ''}`}>
            <IconKey className="h-3.5 w-3.5 shrink-0 text-muted" />
            <input value={r.key} onChange={(e) => set(i, { key: e.target.value })} placeholder="nom" spellCheck={false} className={`${input} w-[13.5rem] shrink-0`} />
            <input type={revealed.has(i) ? 'text' : 'password'} value={r.value} onChange={(e) => set(i, { value: e.target.value })} placeholder="valeur" spellCheck={false} className={`${input} min-w-0 flex-1`} />
            <div className="flex w-20 shrink-0 items-center justify-end gap-2 text-muted">
              <button type="button" onClick={() => navigator.clipboard?.writeText(r.value).then(() => onNotify?.('Valeur copiée'))} className="cursor-pointer hover:text-text" title="Copier la valeur">
                <IconCopy className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => toggle(i)} className="cursor-pointer hover:text-text" title={revealed.has(i) ? 'Masquer' : 'Afficher'}>
                {revealed.has(i) ? <IconEyeOff className="h-3.5 w-3.5" /> : <IconEye className="h-3.5 w-3.5" />}
              </button>
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="cursor-pointer hover:text-danger" title="Supprimer">
                <IconTrash className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-2">
        <button type="button" onClick={() => onChange([...rows, emptyRow()])} className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-surface-hover hover:text-text">
          <IconPlus className="h-3.5 w-3.5" />
          Ajouter une variable
        </button>
      </div>
    </div>
  )
}

function EnvModal({ store, update, onClose, onNotify }) {
  const [id, setId] = useState(store.activeEnv)
  const env = store.environments.find((e) => e.id === id) || store.environments[0]

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setEnv = (p) => update({ ...store, environments: store.environments.map((e) => (e.id === env.id ? { ...e, ...p } : e)) })
  function add(from) {
    const e = newEnv(from ? { name: `${from.name} (copie)`, baseUrl: from.baseUrl, variables: from.variables.map((v) => ({ ...v })) } : { baseUrl: env?.baseUrl || '' })
    update({ ...store, environments: [...store.environments, e] })
    setId(e.id)
  }
  function remove() {
    if (store.environments.length < 2) return
    const rest = store.environments.filter((e) => e.id !== env.id)
    update({ ...store, environments: rest, activeEnv: store.activeEnv === env.id ? rest[0].id : store.activeEnv })
    setId(rest[0].id)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="flex h-[34rem] max-h-full w-full max-w-4xl overflow-hidden rounded-xl border border-border-strong bg-base shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-surface/50">
          <div className="flex items-center px-4 py-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Environnements</span>
            <button type="button" onClick={() => add(null)} className="ml-auto cursor-pointer text-muted hover:text-text" title="Nouvel environnement">
              <IconPlus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="theme-scroll flex-1 overflow-y-auto px-2 pb-2">
            {store.environments.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setId(e.id)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${env.id === e.id ? 'bg-surface-hover text-text' : 'text-muted hover:bg-surface-hover/60 hover:text-text'}`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${store.activeEnv === e.id ? 'bg-success' : 'bg-muted/40'}`} title={store.activeEnv === e.id ? 'Actif' : undefined} />
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
              </button>
            ))}
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-border px-5 py-3">
            <input value={env.name} onChange={(e) => setEnv({ name: e.target.value })} className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-text outline-none" />
            {store.activeEnv !== env.id && (
              <Ghost onClick={() => update({ ...store, activeEnv: env.id })} className="!text-accent">
                Utiliser
              </Ghost>
            )}
            <Ghost onClick={() => add(env)}>Dupliquer</Ghost>
            <Ghost onClick={remove} disabled={store.environments.length < 2} className="hover:!text-danger">
              Supprimer
            </Ghost>
            <button type="button" onClick={onClose} className="cursor-pointer text-muted hover:text-text">
              <IconClose className="h-4 w-4" />
            </button>
          </div>
          <div className="theme-scroll flex-1 overflow-y-auto px-5 py-4">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-muted">URL du serveur</label>
            <input
              value={env.baseUrl}
              onChange={(e) => setEnv({ baseUrl: e.target.value })}
              spellCheck={false}
              placeholder="http://localhost:8080/api"
              className="mb-1 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-[12.5px] text-text outline-none focus:border-accent"
            />
            <p className="mb-5 text-[11.5px] text-muted">
              Disponible partout avec <code className="text-text">{'{{baseUrl}}'}</code> ; une URL qui commence par « / » part de là.
            </p>
            <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Variables</label>
            <VarTable rows={env.variables} onChange={(variables) => setEnv({ variables })} onNotify={onNotify} />
          </div>
        </section>
      </div>
    </div>
  )
}

export function HttpPanel({ repo, onNotify, onAskAi }) {
  const [store, setStore] = useState(null) // { requests, folders, environments, activeEnv }
  const [tabs, setTabs] = useState([]) // open requests: { ...request, _dirty, _resp }
  const [activeId, setActiveId] = useState(null)
  const [section, setSection] = useState('params') // params | headers | body | auth
  const [respTab, setRespTab] = useState('body')
  const [sending, setSending] = useState(false)
  const [envOpen, setEnvOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [routes, setRoutes] = useState(null) // { endpoints, title, source, note } | { error }
  const [loadingApi, setLoadingApi] = useState(false)
  const [filter, setFilter] = useState('')
  const [closedRoutes, setClosedRoutes] = useState(() => new Set()) // route folders collapsed
  const [closedFolders, setClosedFolders] = useState(() => new Set()) // collection folders collapsed
  const [renaming, setRenaming] = useState(null) // { path, value }
  const [dropOn, setDropOn] = useState(null) // folder path (or '') a request is dragged over
  const [fullscreen, setFullscreen] = useState(false)
  const saveTimer = useRef(null)
  const latest = useRef(null)

  const current = tabs.find((t) => t.id === activeId) || tabs[0] || null

  // ---- load / save
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [saved, guess] = await Promise.all([api()?.http_load?.(repo.path), api()?.http_guess_base?.(repo.path)])
      if (cancelled) return
      const base = saved || { requests: [], folders: [], environments: [newEnv({ id: 'default', name: 'Local' })], activeEnv: 'default' }
      // A first-time project gets the server address read from its config.
      const environments = base.environments.map((e) => (e.baseUrl ? e : { ...e, baseUrl: guess?.baseUrl || 'http://localhost:8080' }))
      setStore({ ...base, environments })
      const first = base.requests[0] ? { ...base.requests[0] } : newRequest()
      setTabs([first])
      setActiveId(first.id)
    })()
    return () => {
      cancelled = true
    }
  }, [repo.path])

  const persist = useCallback(
    (next) => {
      latest.current = next
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => api()?.http_save?.(repo.path, latest.current), 400)
    },
    [repo.path],
  )
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        if (latest.current) api()?.http_save?.(repo.path, latest.current)
      }
    },
    [repo.path],
  )

  function update(next) {
    setStore(next)
    persist(next)
  }

  // ---- request tabs
  const patchTab = (id, p) => setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)))
  const patch = (p) => current && patchTab(current.id, { ...p, _dirty: true })

  function openTab(request) {
    setTabs((prev) => (prev.some((t) => t.id === request.id) ? prev : [...prev, { ...request }]))
    setActiveId(request.id)
  }

  function closeTab(id) {
    const rest = tabs.filter((t) => t.id !== id)
    if (rest.length === 0) {
      const blank = newRequest()
      setTabs([blank])
      setActiveId(blank.id)
      return
    }
    if (id === (current?.id || activeId)) setActiveId(rest[Math.max(0, tabs.findIndex((t) => t.id === id) - 1)]?.id || rest[0].id)
    setTabs(rest)
  }

  function closeAllTabs() {
    const dirty = tabs.filter((t) => t._dirty).length
    if (dirty && !window.confirm(`${dirty} requête${dirty > 1 ? 's ont' : ' a'} des changements non enregistrés. Tout fermer quand même ?`)) return
    const blank = newRequest()
    setTabs([blank])
    setActiveId(blank.id)
  }

  const saved = current && store?.requests.find((r) => r.id === current.id)

  function saveCurrent() {
    if (!store || !current) return
    const item = { ...clean(current), name: current.name.trim() || `${current.method} ${current.url}` }
    const exists = store.requests.some((r) => r.id === item.id)
    update({ ...store, requests: exists ? store.requests.map((r) => (r.id === item.id ? item : r)) : [...store.requests, item] })
    patchTab(item.id, { ...item, _dirty: false })
  }

  function removeRequest(id) {
    update({ ...store, requests: store.requests.filter((r) => r.id !== id) })
    patchTab(id, { _dirty: true })
  }

  // ---- send
  const env = store ? store.environments.find((e) => e.id === store.activeEnv) || store.environments[0] : null
  const variables = useMemo(() => {
    const v = { baseUrl: (env?.baseUrl || '').replace(/\/+$/, '') }
    for (const row of env?.variables || []) if (row.enabled !== false && row.key) v[row.key] = row.value
    return v
  }, [env])

  const send = useCallback(async () => {
    if (sending || !current) return
    setSending(true)
    const id = current.id
    const req = { ...clean(current), url: current.url.trim().startsWith('/') ? `{{baseUrl}}${current.url.trim()}` : current.url }
    const r = await api()?.http_send?.(req, variables)
    setSending(false)
    patchTab(id, { _resp: r || { error: 'Pas de réponse du backend' } })
    setRespTab('body')
  }, [current, variables, sending])

  function onKeyDown(e) {
    if (e.key === 'Escape' && fullscreen && !envOpen) {
      setFullscreen(false)
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      send()
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'w') {
      e.preventDefault()
      closeAllTabs()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
      e.preventDefault()
      current && closeTab(current.id)
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      saveCurrent()
    }
  }

  // ---- folders (collections)
  const folderPaths = useMemo(() => {
    const set = new Set(store?.folders || [])
    for (const r of store?.requests || []) {
      let p = r.folder || ''
      while (p) {
        set.add(p)
        p = parentOf(p)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [store])

  function addFolder(parent = '') {
    let name = 'Nouveau dossier'
    let n = 2
    while (folderPaths.includes(joinPath(parent, name))) name = `Nouveau dossier ${n++}`
    const path = joinPath(parent, name)
    update({ ...store, folders: [...store.folders, path] })
    setClosedFolders((prev) => {
      const next = new Set(prev)
      next.delete(parent)
      return next
    })
    setRenaming({ path, value: name })
  }

  function renameFolder(path, name) {
    const clean_ = name.trim().replace(/\//g, '-')
    setRenaming(null)
    if (!clean_ || clean_ === leafOf(path)) return
    const to = joinPath(parentOf(path), clean_)
    if (folderPaths.includes(to)) return onNotify?.('Ce dossier existe déjà', true)
    const move = (p) => (p === path ? to : p.startsWith(`${path}/`) ? to + p.slice(path.length) : p)
    update({
      ...store,
      folders: [...new Set(store.folders.map(move))],
      requests: store.requests.map((r) => ({ ...r, folder: move(r.folder || '') })),
    })
    setTabs((prev) => prev.map((t) => ({ ...t, folder: move(t.folder || '') })))
  }

  // Deleting a folder keeps its requests: they move up one level.
  function deleteFolder(path) {
    const up = parentOf(path)
    const inside = (p) => p === path || p.startsWith(`${path}/`)
    update({
      ...store,
      folders: store.folders.filter((f) => !inside(f)),
      requests: store.requests.map((r) => (inside(r.folder || '') ? { ...r, folder: up } : r)),
    })
  }

  function moveRequest(id, folder) {
    update({ ...store, requests: store.requests.map((r) => (r.id === id ? { ...r, folder } : r)) })
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, folder } : t)))
  }

  // ---- import / export (Postman v2.1, Insomnia v4)
  async function importCollection() {
    setMenuOpen(false)
    const r = await api()?.http_import_collection?.()
    if (!r || r.cancelled) return
    if (r.error) return onNotify?.(r.error, true)
    const top = r.name
    const requests = r.requests.map((q) => ({ ...q, folder: joinPath(top, q.folder) }))
    const next = { ...store, requests: [...store.requests, ...requests], folders: [...new Set([...store.folders, top])] }
    if (r.variables?.length) {
      const e = newEnv({ name: top, baseUrl: env?.baseUrl || '', variables: r.variables })
      next.environments = [...store.environments, e]
      next.activeEnv = e.id
    }
    update(next)
    onNotify?.(`${requests.length} requête${requests.length > 1 ? 's' : ''} importée${requests.length > 1 ? 's' : ''} dans « ${top} »`)
  }

  async function exportCollection() {
    setMenuOpen(false)
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    await api()?.http_save?.(repo.path, store)
    const r = await api()?.http_export_collection?.(repo.path)
    if (!r || r.cancelled) return
    if (r.error) return onNotify?.(r.error, true)
    onNotify?.(`${r.count} requête${r.count > 1 ? 's' : ''} exportée${r.count > 1 ? 's' : ''} vers ${r.path}`)
  }

  // ---- routes: the running server's OpenAPI, else read from the code
  async function importRoutes() {
    if (!store) return
    setLoadingApi(true)
    const r = await api()?.http_import_routes?.(repo.path, env?.baseUrl || '', false)
    setLoadingApi(false)
    setRoutes(r || { error: 'Pas de réponse du backend' })
    setFilter('')
    // A big API (hundreds of routes) starts with its folders closed.
    setClosedRoutes(r?.endpoints?.length > 40 ? new Set(r.endpoints.flatMap((e) => [e.tag.split(' / ')[0], e.tag])) : new Set())
  }

  const toParams = (e) => (e.params || []).filter((p) => p.in === 'query').map((p) => ({ key: p.key, value: '', enabled: !!p.required }))
  const toPath = (e) => e.path.replace(/\{([^}]+)\}/g, '{{$1}}')

  function fromRoute(e) {
    const r = newRequest({ method: e.method, url: toPath(e), name: e.summary || `${e.method} ${e.path}`, body: e.body || '', params: toParams(e) })
    openTab({ ...r, _dirty: true })
    setSection(e.body ? 'body' : 'params')
  }

  function keepAllRoutes() {
    if (!store || !routes?.endpoints) return
    const known = new Set(store.requests.map((r) => `${r.method} ${r.url}`))
    const top = repo.name || repo.path.split(/[\\/]/).filter(Boolean).pop() || 'API'
    const add = routes.endpoints
      .map((e) => newRequest({ method: e.method, url: toPath(e), name: e.summary || `${e.method} ${e.path}`, body: e.body || '', params: toParams(e), folder: joinPath(top, ...e.tag.split(' / ')) }))
      .filter((r) => !known.has(`${r.method} ${r.url}`))
    update({ ...store, requests: [...store.requests, ...add], folders: [...new Set([...store.folders, top])] })
    // They now live in the collection: the detection list steps aside and the new
    // collection opens in rename mode so it gets a proper name right away.
    setRoutes(null)
    setClosedFolders((prev) => new Set([...prev, top]))
    setRenaming({ path: top, value: top })
    onNotify?.(`${add.length} requête${add.length > 1 ? 's' : ''} ajoutée${add.length > 1 ? 's' : ''} à la collection « ${top} »`)
  }

  function copy(text) {
    navigator.clipboard?.writeText(text).then(() => onNotify?.('Copié'))
  }

  const resp = current?._resp
  function askAi() {
    if (!resp || !current) return
    const sent = `${current.method} ${resp.url || current.url}${current.body ? `\n\nCorps envoyé :\n${current.body}` : ''}`
    const got = resp.error ? `Erreur : ${resp.error}` : `Réponse ${resp.status} ${resp.reason} :\n${(resp.pretty || resp.body || '').slice(0, 3000)}`
    onAskAi?.(`Cette requête sur mon API renvoie une erreur.\n\n${sent}\n\n${got}\n\nTrouve la cause dans le code du projet et corrige-la.`)
  }

  const q = filter.trim().toLowerCase()
  // Routes grouped as a tree: "admin" > "admin / analytics" (the backend names the groups).
  const kept = useMemo(() => new Set((store?.requests || []).map((r) => `${r.method} ${r.url}`)), [store])
  const routeGroups = useMemo(() => {
    const tops = new Map()
    for (const e of routes?.endpoints || []) {
      if (kept.has(`${e.method} ${toPath(e)}`)) continue
      if (q && !`${e.method} ${e.path} ${e.summary}`.toLowerCase().includes(q)) continue
      const [top, sub] = e.tag.split(' / ')
      if (!tops.has(top)) tops.set(top, { total: 0, direct: [], subs: new Map() })
      const node = tops.get(top)
      node.total++
      if (sub) node.subs.set(sub, [...(node.subs.get(sub) || []), e])
      else node.direct.push(e)
    }
    return [...tops.entries()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, q, kept])
  const remaining = (routes?.endpoints || []).filter((e) => !kept.has(`${e.method} ${toPath(e)}`)).length

  if (!store || !current) return <div className="py-10 text-center text-[13px] text-muted">Chargement…</div>

  const enabledCount = (rows) => rows.filter((r) => r.enabled !== false && r.key).length
  const fullUrl = current.url.trim().startsWith('/') ? `${variables.baseUrl}${current.url.trim()}` : current.url
  const tabBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setSection(id)}
      className={`-mb-px cursor-pointer border-b-2 px-0.5 py-2 text-[12.5px] ${section === id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}
    >
      {label}
    </button>
  )

  const requestRow = (r, depth) => (
    <div
      key={r.id}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)}
      className={`group flex items-center gap-1 rounded-md pr-1 ${current.id === r.id ? 'bg-surface-hover' : 'hover:bg-surface-hover/50'}`}
      style={{ paddingLeft: depth * 14 }}
    >
      <button type="button" onClick={() => openTab(r)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1.5 py-1.5 text-left">
        <MethodTag m={r.method} />
        <span className="min-w-0 truncate text-[12.5px] text-text">{r.name}</span>
      </button>
      <button type="button" onClick={() => removeRequest(r.id)} className="hidden cursor-pointer px-1 text-muted hover:text-danger group-hover:block" title="Supprimer de mes requêtes">
        <IconTrash className="h-3 w-3" />
      </button>
    </div>
  )

  const renderLevel = (parent, depth) => [
    ...folderPaths
      .filter((f) => parentOf(f) === parent && (f.includes('/') ? parent !== '' : true))
      .flatMap((path) => {
        const folded = closedFolders.has(path)
        const count = store.requests.filter((r) => (r.folder || '') === path || (r.folder || '').startsWith(`${path}/`)).length
        return [
          <div
            key={`f:${path}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDropOn(path)
            }}
            onDragLeave={() => setDropOn((d) => (d === path ? null : d))}
            onDrop={(e) => {
              e.preventDefault()
              setDropOn(null)
              const id = e.dataTransfer.getData('text/plain')
              if (id) moveRequest(id, path)
            }}
            className={`group flex items-center gap-1.5 rounded-md py-1 pr-1 ${dropOn === path ? 'bg-accent-bg ring-1 ring-accent/60' : 'hover:bg-surface-hover/50'}`}
            style={{ paddingLeft: depth * 14 + 4 }}
          >
            <button
              type="button"
              onClick={() =>
                setClosedFolders((prev) => {
                  const next = new Set(prev)
                  if (next.has(path)) next.delete(path)
                  else next.add(path)
                  return next
                })
              }
              onDoubleClick={() => setRenaming({ path, value: leafOf(path) })}
              title="Double-clic pour renommer"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
            >
              <span className={`text-[8px] text-muted transition-transform ${folded ? '' : 'rotate-90'}`}>▶</span>
              <IconFolder className="h-3.5 w-3.5 shrink-0 text-muted" />
              {renaming?.path === path ? (
                <input
                  autoFocus
                  value={renaming.value}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenaming({ path, value: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') renameFolder(path, renaming.value)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={() => renameFolder(path, renaming.value)}
                  className="min-w-0 flex-1 rounded border border-accent bg-base px-1 text-[12.5px] text-text outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">{leafOf(path)}</span>
              )}
              <span className="text-[10.5px] tabular-nums text-muted/60">{count}</span>
            </button>
            <span className="hidden shrink-0 items-center gap-1.5 text-muted group-hover:flex">
              {folderPaths.some((f) => f.startsWith(`${path}/`)) && (
                <button
                  type="button"
                  onClick={() => setClosedFolders((prev) => new Set([...prev, ...folderPaths.filter((f) => f.startsWith(`${path}/`))]))}
                  className="cursor-pointer hover:text-text"
                  title="Replier tous les sous-dossiers"
                >
                  <IconChevronDown className="h-3 w-3 rotate-180" />
                </button>
              )}
              <button type="button" onClick={() => addFolder(path)} className="cursor-pointer hover:text-text" title="Nouveau sous-dossier">
                <IconPlus className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => setRenaming({ path, value: leafOf(path) })} className="cursor-pointer hover:text-text" title="Renommer">
                <IconPencil className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => deleteFolder(path)} className="cursor-pointer hover:text-danger" title="Supprimer le dossier (les requêtes sont conservées)">
                <IconTrash className="h-3 w-3" />
              </button>
            </span>
          </div>,
          ...(folded ? [] : renderLevel(path, depth + 1)),
        ]
      }),
    ...store.requests.filter((r) => (r.folder || '') === parent).map((r) => requestRow(r, depth + (parent ? 1 : 0))),
  ]

  const allClosed = folderPaths.length > 0 && folderPaths.every((f) => closedFolders.has(f))
  const flatMatches = q ? store.requests.filter((r) => `${r.method} ${r.name} ${r.url} ${r.folder || ''}`.toLowerCase().includes(q)) : []

  return (
    <div
      className={fullscreen ? 'fullscreen-below-tabs z-50 overflow-hidden bg-surface' : 'h-[75vh] overflow-hidden rounded-lg border border-border bg-surface'}
      onKeyDown={onKeyDown}
    >
    <div className="grid h-full lg:grid-cols-[19rem_minmax(0,1fr)]">
      {/* ---------------------------------------------------- sidebar */}
      <aside className="flex h-full min-h-0 min-w-0 flex-col border-border px-4 pt-4 lg:border-r">
        {/* environment */}
        <div className="mb-3 flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
<Select
              value={store.activeEnv}
              onChange={(v) => update({ ...store, activeEnv: v })}
              options={store.environments.map((e) => ({ value: e.id, label: e.name }))}
              title="Environnement actif"
              className="w-full rounded-md border border-border bg-surface-hover/40 px-2.5 py-1.5 text-[12.5px] text-text focus:border-accent"
            />
          </div>
          <button type="button" onClick={() => setEnvOpen(true)} className="cursor-pointer rounded-md border border-border px-2.5 py-1.5 text-[12px] text-muted hover:border-border-strong hover:text-text" title="Gérer les environnements et leurs variables">
            Gérer
          </button>
        </div>
        <p className="mb-3 truncate px-1 font-mono text-[11px] text-muted" title={env?.baseUrl}>
          {env?.baseUrl || 'Aucune URL de serveur'}
        </p>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrer"
          className="mb-2 w-full rounded-md bg-surface-hover/40 px-2.5 py-1.5 text-[12.5px] text-text outline-none placeholder:text-muted focus:bg-surface-hover/70"
        />

        <div className="theme-scroll -mr-2 min-h-0 flex-1 overflow-y-auto pr-2 pb-3">
          <div
            className={`flex items-center gap-2 rounded-md px-1 pb-1 pt-2 ${dropOn === '' ? 'bg-accent-bg' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDropOn('')
            }}
            onDragLeave={() => setDropOn(null)}
            onDrop={(e) => {
              e.preventDefault()
              setDropOn(null)
              const id = e.dataTransfer.getData('text/plain')
              if (id) moveRequest(id, '')
            }}
          >
            <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted">Collection</span>
            <div className="relative ml-auto flex items-center gap-2.5 text-muted">
              <button type="button" onClick={() => openTab(newRequest())} className="cursor-pointer hover:text-text" title="Nouvelle requête">
                <IconPlus className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => addFolder('')} className="cursor-pointer hover:text-text" title="Nouveau dossier">
                <IconFolder className="h-3.5 w-3.5" />
              </button>
              {folderPaths.length > 0 && (
                <button
                  type="button"
                  onClick={() => setClosedFolders(allClosed ? new Set() : new Set(folderPaths))}
                  className="cursor-pointer hover:text-text"
                  title={allClosed ? 'Tout déplier' : 'Tout replier'}
                >
                  <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${allClosed ? '' : 'rotate-180'}`} />
                </button>
              )}
              <button type="button" onClick={() => setMenuOpen((v) => !v)} className="cursor-pointer text-[15px] leading-none hover:text-text" title="Importer / exporter">
                ⋯
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-border-strong bg-surface p-1 shadow-lg" onMouseLeave={() => setMenuOpen(false)}>
                  {[
                    ['Importer une collection…', 'Postman v2.1 ou Insomnia (JSON)', importCollection],
                    ['Exporter la collection…', 'Postman v2.1, lisible par Insomnia, Bruno…', exportCollection],
                  ].map(([label, hint, run]) => (
                    <button key={label} type="button" onClick={run} className="flex w-full cursor-pointer flex-col items-start rounded px-2 py-1.5 text-left hover:bg-surface-hover">
                      <span className="text-[12px] text-text">{label}</span>
                      <span className="text-[10.5px] text-muted">{hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {q ? (
            flatMatches.length ? flatMatches.map((r) => requestRow(r, 0)) : <p className="px-1 py-2 text-[12px] text-muted">Aucune requête.</p>
          ) : store.requests.length === 0 && folderPaths.length === 0 ? (
            <p className="px-1 pb-2 text-[12px] leading-snug text-muted">Vide pour l'instant. Sauvegarde une requête (Ctrl+S), crée un dossier ou importe une collection Postman / Insomnia.</p>
          ) : (
            renderLevel('', 0)
          )}

          <div className="flex items-center px-1 pb-1 pt-5">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted">Routes{routes?.endpoints ? ` · ${remaining}` : ''}</span>
            {routes?.endpoints && remaining > 0 && (
              <Ghost onClick={keepAllRoutes} className="ml-auto" title="Ajouter toutes les routes à la collection">
                Tout garder
              </Ghost>
            )}
          </div>
          {!routes && (
            <button type="button" onClick={importRoutes} disabled={loadingApi} className="mx-1 cursor-pointer text-left text-[12.5px] text-accent hover:underline disabled:opacity-60">
              {loadingApi ? 'Recherche…' : 'Importer les routes'}
              <span className="mt-0.5 block text-[11.5px] text-muted no-underline">Depuis le serveur s'il tourne, sinon lues dans le code.</span>
            </button>
          )}
          {routes?.error && <p className="px-1 text-[12px] leading-snug text-muted">{routes.error}.</p>}
          {routes?.note && <p className="px-1 pb-1.5 text-[11.5px] leading-snug text-muted">{routes.note}</p>}
          {routeGroups.map(([top, node]) => {
            const folded = !q && closedRoutes.has(top)
            const toggle = (key) =>
              setClosedRoutes((prev) => {
                const next = new Set(prev)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
              })
            const routeBtn = (e, indent) => (
              <button key={`${e.method}${e.path}`} type="button" onClick={() => fromRoute(e)} className="flex w-full cursor-pointer items-center gap-2 rounded-md py-1 pr-1.5 text-left hover:bg-surface-hover/50" style={{ paddingLeft: indent }} title={e.summary || `${e.method} ${e.path}`}>
                <MethodTag m={e.method} />
                <span className="min-w-0 truncate font-mono text-[11.5px] text-text/90">{e.path}</span>
              </button>
            )
            return (
              <div key={top}>
                <button type="button" onClick={() => toggle(top)} className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] text-text hover:bg-surface-hover/50">
                  <span className={`text-[8px] text-muted transition-transform ${folded ? '' : 'rotate-90'}`}>▶</span>
                  <span className="min-w-0 flex-1 truncate">{top}</span>
                  <span className="text-[10.5px] tabular-nums text-muted/60">{node.total}</span>
                </button>
                {!folded && node.direct.map((e) => routeBtn(e, 18))}
                {!folded &&
                  [...node.subs.entries()].map(([sub, list]) => {
                    const key = `${top} / ${sub}`
                    const subFolded = !q && closedRoutes.has(key)
                    return (
                      <div key={key}>
                        <button type="button" onClick={() => toggle(key)} className="flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pl-4 pr-1 text-left text-[12px] text-muted hover:text-text">
                          <span className={`text-[8px] transition-transform ${subFolded ? '' : 'rotate-90'}`}>▶</span>
                          <span className="min-w-0 flex-1 truncate">{sub}</span>
                          <span className="text-[10.5px] tabular-nums text-muted/60">{list.length}</span>
                        </button>
                        {!subFolded && list.map((e) => routeBtn(e, 34))}
                      </div>
                    )
                  })}
              </div>
            )
          })}
          {routes?.endpoints && remaining === 0 && <p className="px-1 pb-1 text-[12px] text-muted">Toutes les routes détectées sont dans ta collection.</p>}
          {routes?.endpoints && (
            <Ghost onClick={importRoutes} disabled={loadingApi} className="mt-3 px-1">
              {loadingApi ? 'Recherche…' : 'Actualiser les routes'}
            </Ghost>
          )}
        </div>
      </aside>

      {/* ---------------------------------------------------- editor */}
      <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden px-6 pb-4 pt-2">
        {/* open requests */}
        <div className="mb-3 flex items-center border-b border-border">
        <div className="theme-scroll -mx-1 flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`group flex shrink-0 items-center gap-2 border-b-2 pl-3 pr-1.5 ${t.id === current.id ? 'border-accent bg-surface-hover/30' : 'border-transparent hover:bg-surface-hover/20'}`}
            >
              <button type="button" onClick={() => setActiveId(t.id)} className="flex cursor-pointer items-center gap-2 py-2">
                <MethodTag m={t.method} />
                <span className={`max-w-[11rem] truncate text-[12.5px] ${t.id === current.id ? 'text-text' : 'text-muted'}`}>{t.name || t.url}</span>
              </button>
              <button type="button" onClick={() => closeTab(t.id)} className="flex h-4 w-4 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-hover hover:text-text" title="Fermer">
                {t._dirty ? <span className="h-1.5 w-1.5 rounded-full bg-accent group-hover:hidden" /> : null}
                <IconClose className={`h-3 w-3 ${t._dirty ? 'hidden group-hover:block' : ''}`} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => openTab(newRequest())} className="ml-1 shrink-0 cursor-pointer rounded px-2 py-1 text-muted hover:bg-surface-hover hover:text-text" title="Nouvelle requête">
            <IconPlus className="h-3.5 w-3.5" />
          </button>
        </div>
          {tabs.length > 1 && (
            <button type="button" onClick={closeAllTabs} className="ml-2 shrink-0 cursor-pointer whitespace-nowrap px-1 text-[11.5px] text-muted hover:text-text" title="Fermer tous les onglets (Ctrl+Maj+W)">
              Tout fermer
            </button>
          )}
          <button type="button" onClick={() => setFullscreen((v) => !v)} className="ml-2 shrink-0 cursor-pointer px-1 text-muted hover:text-text" title={fullscreen ? 'Quitter le plein écran (Échap)' : 'Plein écran'}>
            <IconMaximize className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* one bar: method | url | send */}
        <div className="flex items-stretch rounded-md border border-border-strong focus-within:border-accent">
<div className="w-28 shrink-0 border-r border-border">
            <Select
              value={current.method}
              onChange={(v) => patch({ method: v })}
              options={METHODS.map((m) => ({ value: m, label: m, color: METHOD_COLOR[m] }))}
              className="h-full rounded-l-[5px] px-3 text-[12.5px] font-semibold hover:bg-surface-hover/40"
            />
          </div>
          <input
            value={current.url}
            onChange={(e) => patch({ url: e.target.value })}
            spellCheck={false}
            placeholder="/chemin ou http://…"
            className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-[12.5px] text-text outline-none"
          />
          <button type="button" onClick={send} disabled={sending} className="cursor-pointer rounded-r-[5px] bg-accent px-5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-60" title="Ctrl+Entrée">
            {sending ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
        <div className="flex items-center gap-3 px-0.5 pb-1 pt-2">
          <input
            value={current.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Nom de la requête"
            className="w-48 bg-transparent text-[12.5px] text-text outline-none placeholder:text-muted/70"
          />
<Select
            value={current.folder || ''}
            onChange={(v) => patch({ folder: v })}
            options={[{ value: '', label: 'Sans dossier' }, ...folderPaths.map((f) => ({ value: f, label: f }))]}
            title="Dossier de la collection"
            className="max-w-[11rem] text-[12px] text-muted hover:text-text"
          />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={fullUrl}>
            {fullUrl}
          </span>
          <Ghost onClick={saveCurrent} title="Ctrl+S" className={current._dirty || !saved ? '!text-accent' : ''}>
            {saved ? (current._dirty ? 'Enregistrer les changements' : 'Enregistrée ✓') : 'Sauvegarder'}
          </Ghost>
        </div>

        <div className="mt-2 flex gap-5 border-b border-border">
          {tabBtn('params', `Paramètres${enabledCount(current.params) ? ` ${enabledCount(current.params)}` : ''}`)}
          {tabBtn('headers', `En-têtes${enabledCount(current.headers) ? ` ${enabledCount(current.headers)}` : ''}`)}
          {tabBtn('body', 'Corps')}
          {tabBtn('auth', 'Bearer')}
        </div>
        <div className="theme-scroll max-h-[45%] shrink-0 overflow-y-auto pt-3">
          {section === 'params' && <Rows rows={current.params} onChange={(rows) => patch({ params: rows })} keyPlaceholder="clé" valuePlaceholder="valeur" />}
          {section === 'headers' && <Rows rows={current.headers} onChange={(rows) => patch({ headers: rows })} keyPlaceholder="En-tête" valuePlaceholder="valeur" />}
          {section === 'body' && (
            <div className="h-44 overflow-hidden rounded-md border border-border">
              {current.method === 'GET' ? (
                <p className="p-3 text-[12px] text-muted">Un GET n'envoie pas de corps.</p>
              ) : (
                <CodeEditor key={current.id} value={current.body} onChange={(v) => patch({ body: v })} onSave={saveCurrent} language="json" file="body.json" />
              )}
            </div>
          )}
          {section === 'auth' && (
            <div>
              <input
                value={current.bearer}
                onChange={(e) => patch({ bearer: e.target.value })}
                spellCheck={false}
                placeholder="{{token}}"
                className="w-full border-b border-border bg-transparent px-1 py-1.5 font-mono text-[12px] text-text outline-none placeholder:text-muted/60 focus:border-accent"
              />
              <p className="mt-2 px-1 text-[11.5px] text-muted">Envoyé en <code className="text-text">Authorization: Bearer …</code>. Mets le jeton dans une variable de l'environnement pour le réutiliser partout.</p>
            </div>
          )}
        </div>

        {/* ------------------------------------------------ response */}
        <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-border pt-3">
          {!resp && (
            <EmptyState className="min-h-0 flex-1" title={sending ? 'En attente du serveur…' : 'Aucune réponse pour l’instant'} pulse={sending}>
              {sending ? 'La requête est partie.' : 'Envoie la requête avec le bouton ou Ctrl+Entrée : la réponse s’affichera ici.'}
            </EmptyState>
          )}
          {resp?.error && (
            <div className="flex flex-wrap items-center gap-3 py-3">
              <span className="h-2 w-2 rounded-full bg-danger" />
              <span className="text-[13px] text-danger">{resp.error}</span>
              {onAskAi && (
                <Ghost onClick={askAi} className="ml-auto !text-accent">
                  Demander à l'IA
                </Ghost>
              )}
            </div>
          )}
          {resp && !resp.error && (
            <>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pb-3 text-[12px] text-muted">
                <span>
                  Statut : <span className={`font-semibold tabular-nums ${statusTone(resp.status)[1]}`}>{resp.status}</span>
                  <span className="mx-1.5 text-muted/50">•</span>
                  <span className={statusTone(resp.status)[1]}>{resp.reason}</span>
                </span>
                <span>
                  Durée : <span className="tabular-nums text-success">{resp.ms} ms</span>
                </span>
                <span>
                  Taille : <span className="tabular-nums text-success">{size(resp.size)}</span>
                </span>
                {resp.truncated && <span className="text-warning">tronquée</span>}
                {onAskAi && resp.status >= 400 && (
                  <Ghost onClick={askAi} className="ml-auto !text-accent">
                    Demander à l'IA
                  </Ghost>
                )}
              </div>
              <div className="flex items-center gap-5 border-b border-border">
                {[
                  ['body', resp.pretty ? 'JSON' : 'Corps'],
                  ['raw', 'Brut'],
                  ['headers', `En-têtes ${resp.headers.length}`],
                ].map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setRespTab(id)} className={`-mb-px cursor-pointer border-b-2 px-0.5 py-2 text-[12.5px] ${respTab === id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}>
                    {label}
                  </button>
                ))}
                <Ghost onClick={() => copy(respTab === 'headers' ? resp.headers.map(([k, v]) => `${k}: ${v}`).join('\n') : respTab === 'raw' ? resp.body : resp.pretty || resp.body)} className="ml-auto">
                  Copier
                </Ghost>
              </div>
              {respTab === 'headers' ? (
                <div className="theme-scroll min-h-0 flex-1 overflow-y-auto px-1 py-3 font-mono text-[12px] leading-relaxed">
                  {resp.headers.map(([k, v], i) => (
                    <div key={i} className="flex gap-4">
                      <span className="w-44 shrink-0 truncate text-muted" title={k}>
                        {k}
                      </span>
                      <span className="min-w-0 break-all text-text">{v}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 min-h-[8rem] flex-1 overflow-hidden rounded-md border border-border">
                  <CodeEditor key={`${current.id}-${respTab}-${resp.ms}-${resp.size}`} value={respTab === 'raw' ? resp.body : resp.pretty || resp.body || ''} readOnly language={respTab === 'body' && resp.pretty ? 'json' : 'text'} file={respTab === 'body' && resp.pretty ? 'response.json' : 'response.txt'} />
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {envOpen && <EnvModal store={store} update={update} onClose={() => setEnvOpen(false)} onNotify={onNotify} />}
    </div>
    </div>
  )
}

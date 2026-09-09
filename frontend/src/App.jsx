import { useEffect, useState, useCallback, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import {
  IconFolder,
  IconLayers,
  IconBranch,
  IconArrowUp,
  IconArrowDown,
  IconExternal,
  IconRefresh,
  IconPlus,
  IconTrash,
  IconChevronLeft,
  IconScan,
  IconGitCommit,
  IconClose,
  IconTerminal,
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconSettings,
  IconSparkle,
  IconPencil,
  IconMonitor,
  IconMaximize,
  IconWinMinimize,
  IconWinMaximize,
  IconStar,
  IconShield,
  IconSearch,
  IconCopy,
  IconCheck,
  IconAlertCircle,
  IconTable,
  IconPalette,
} from './icons'

function api() {
  return window.pywebview?.api
}

// Multiple views can attach to the same PTY (e.g. a repo's Run tab and the
// global Processus drawer showing the same running command) — a plain
// `window.__devhub_onTerminalData = fn` assignment would let the last mount
// clobber the previous one, so every subscriber is tracked in a set instead.
const terminalDataListeners = new Map()
const terminalExitListeners = new Map()

window.__devhub_onTerminalData = (id, data) => {
  terminalDataListeners.get(id)?.forEach((fn) => fn(data))
}
window.__devhub_onTerminalExit = (id) => {
  terminalExitListeners.get(id)?.forEach((fn) => fn())
  terminalDataListeners.delete(id)
  terminalExitListeners.delete(id)
}

function subscribeTerminal(id, onData, onExit) {
  if (!terminalDataListeners.has(id)) terminalDataListeners.set(id, new Set())
  if (!terminalExitListeners.has(id)) terminalExitListeners.set(id, new Set())
  terminalDataListeners.get(id).add(onData)
  terminalExitListeners.get(id).add(onExit)
  return () => {
    terminalDataListeners.get(id)?.delete(onData)
    terminalExitListeners.get(id)?.delete(onExit)
  }
}

const IDE_LABELS = {
  webstorm: 'WebStorm',
  idea1: 'IntelliJ IDEA',
  pycharm: 'PyCharm',
  code: 'VS Code',
  rider: 'Rider',
  goland: 'GoLand',
  clion: 'CLion',
  phpstorm: 'PhpStorm',
}

function Button({ variant = 'ghost', className = '', children, ...props }) {
  const base =
    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
  const variants = {
    primary: 'bg-accent text-white hover:bg-accent-hover',
    ghost: 'border border-border text-text hover:bg-surface-hover hover:border-border-strong',
    subtle: 'text-muted hover:text-text hover:bg-surface-hover',
    danger: 'text-muted hover:text-danger hover:bg-danger-bg',
    'solid-danger': 'bg-danger text-white hover:opacity-90',
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

function StatusBadges({ status }) {
  if (!status || status.error) {
    return <span className="text-xs text-danger">{status?.error || 'statut indisponible'}</span>
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 font-mono text-[11px] text-muted">
        <IconBranch className="h-3 w-3" />
        {status.branch || '?'}
      </span>
      {status.ahead > 0 && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-success-bg px-2 py-0.5 text-[11px] text-success">
          <IconArrowUp className="h-3 w-3" />
          {status.ahead}
        </span>
      )}
      {status.behind > 0 && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-warning-bg px-2 py-0.5 text-[11px] text-warning">
          <IconArrowDown className="h-3 w-3" />
          {status.behind}
        </span>
      )}
      {status.conflicted?.length > 0 && (
        <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-medium text-danger">
          {status.conflicted.length} conflit(s)
        </span>
      )}
      {status.dirty > 0 && (
        <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[11px] text-warning">{status.dirty} modifié(s)</span>
      )}
      {status.untracked > 0 && (
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] text-muted">{status.untracked} non suivi(s)</span>
      )}
      {status.clean && status.ahead === 0 && status.behind === 0 && (
        <span className="rounded-full bg-success-bg px-2 py-0.5 text-[11px] text-success">à jour</span>
      )}
    </div>
  )
}

function GroupSelect({ groups, onPick }) {
  const [open, setOpen] = useState(false)
  if (groups.length === 0) return null
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-text hover:border-border-strong cursor-pointer"
      >
        <IconLayers className="h-3 w-3" />
        Ajouter à…
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-10 mt-1 w-40 overflow-hidden rounded-md border border-border-strong bg-surface shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {groups.map((g) => (
            <button
              key={g.name}
              onClick={() => {
                onPick(g.name)
                setOpen(false)
              }}
              className="block w-full truncate px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-hover cursor-pointer"
            >
              {g.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function IdeButton({ ides, defaultIde, launching, onLaunch, size = 'md' }) {
  const [open, setOpen] = useState(false)
  const label = launching ? 'Ouverture…' : IDE_LABELS[defaultIde] || 'Ouvrir dans l\'IDE'
  const padding = size === 'sm' ? 'px-3 py-1.5 text-[13px]' : 'px-3 py-1.5 text-[13px]'

  return (
    <div className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        disabled={launching}
        onClick={() => onLaunch(defaultIde)}
        className={`inline-flex items-center gap-1.5 rounded-l-md bg-accent ${padding} font-medium text-white transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer`}
      >
        <IconExternal className="h-3.5 w-3.5" />
        {label}
      </button>
      <button
        disabled={launching}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center rounded-r-md border-l border-accent-hover bg-accent px-1.5 text-white transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
        title="Choisir l'IDE"
      >
        <IconChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-md border border-border-strong bg-surface shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {ides.map((id) => (
            <button
              key={id}
              onClick={() => {
                onLaunch(id)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-surface-hover cursor-pointer ${
                id === defaultIde ? 'text-accent' : 'text-text'
              }`}
            >
              {IDE_LABELS[id] || id}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const TERMINAL_LABELS = { cmd: 'CMD', powershell: 'PowerShell', bash: 'Git Bash' }

function TerminalButton({ path, terminals, onNotify }) {
  const [open, setOpen] = useState(false)

  async function launch(kind) {
    setOpen(false)
    const result = await api().open_terminal(path, kind)
    if (result?.error) onNotify(`Terminal : ${result.error}`, true)
  }

  if (!terminals || terminals.length === 0) return null

  return (
    <div className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <Button variant="ghost" onClick={() => launch(terminals[0])} title={`Ouvrir ${TERMINAL_LABELS[terminals[0]]} ici`}>
        <IconTerminal className="h-3.5 w-3.5" />
        Terminal
      </Button>
      {terminals.length > 1 && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-1 rounded-md border border-border px-1.5 text-muted hover:text-text cursor-pointer"
          title="Choisir le terminal"
        >
          <IconChevronDown className="h-3 w-3" />
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-36 overflow-hidden rounded-md border border-border-strong bg-surface shadow-lg">
          {terminals.map((kind) => (
            <button
              key={kind}
              onClick={() => launch(kind)}
              className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-text hover:bg-surface-hover cursor-pointer"
            >
              {TERMINAL_LABELS[kind] || kind}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyStateIllustration({ className }) {
  return (
    <svg viewBox="0 0 120 100" className={className} fill="none">
      <g opacity="0.9">
        <path d="M20 62 60 42l40 20-40 20-40-20Z" fill="var(--color-accent-bg)" stroke="var(--color-accent)" strokeWidth="1.5" />
        <path d="M20 62v10l40 20 40-20V62" stroke="var(--color-border-strong)" strokeWidth="1.5" strokeLinejoin="round" />
        <rect x="42" y="18" width="36" height="24" rx="2" transform="skewX(0)" fill="var(--color-surface)" stroke="var(--color-border-strong)" strokeWidth="1.5" />
        <path d="M48 24h24M48 30h16" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  )
}

function EmptyState({ message, className, size = 'md' }) {
  const dims = size === 'sm' ? 'h-16 w-16' : 'h-24 w-24'
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong p-8 text-center text-xs text-muted ${className || ''}`}
    >
      <EmptyStateIllustration className={dims} />
      <p>{message}</p>
    </div>
  )
}

function RepoCard({ repo, groups, ides, onOpen, onOpenIde, onRemove, onAddToGroup, groupContext, onRemoveFromGroup, currentGroup, selectable, selected, onToggleSelect, runningCount = 0 }) {
  const [launching, setLaunching] = useState(false)

  async function handleOpenIde(ide) {
    setLaunching(true)
    try {
      await onOpenIde(repo.path, ide)
      setTimeout(() => setLaunching(false), 3000)
    } catch {
      // A rejected bridge call used to leave the spinner stuck forever.
      setLaunching(false)
    }
  }

  return (
    <div
      onClick={() => onOpen(repo)}
      className="group cursor-pointer rounded-xl border border-border bg-surface p-4 flex flex-col gap-3 shadow-[var(--card-shadow)] transition-all duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-hover hover:shadow-[var(--card-shadow-hover)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          {selectable ? (
            <input
              type="checkbox"
              checked={!!selected}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleSelect(repo.path)}
              title="Inclure dans le lancement du groupe"
              className="mt-2 h-3.5 w-3.5 shrink-0 cursor-pointer"
            />
          ) : (
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-bg text-accent">
              <IconFolder className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {runningCount > 0 && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
                  title={`${runningCount} processus en cours`}
                />
              )}
              <h3 className="truncate text-sm font-medium text-text">{repo.name}</h3>
            </div>
            <p className="truncate font-mono text-[11px] text-muted">{repo.path}</p>
          </div>
        </div>
        {groupContext ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemoveFromGroup(repo.path)
            }}
            className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger cursor-pointer"
            title="Retirer du groupe"
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove(repo.path)
            }}
            className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger cursor-pointer"
            title="Retirer de la liste"
          >
            <IconTrash className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <StatusBadges status={repo.status} />

      <div className="flex items-center justify-between pt-1">
        <IdeButton ides={ides} defaultIde={repo.ide} launching={launching} onLaunch={handleOpenIde} />
        {!groupContext &&
          (currentGroup ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted">
              <IconLayers className="h-3 w-3" />
              {currentGroup}
            </span>
          ) : (
            <GroupSelect groups={groups} onPick={(name) => onAddToGroup(name, repo.path)} />
          ))}
      </div>
    </div>
  )
}

function EnvPanel({ repo, onNotify }) {
  const [files, setFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  const [entries, setEntries] = useState([])
  const [revealed, setRevealed] = useState(() => new Set())
  const [dirty, setDirty] = useState(false)

  const loadFiles = useCallback(async () => {
    const list = await api().list_env_files(repo.path)
    const safe = Array.isArray(list) ? list : []
    setFiles(safe)
    setActiveFile((prev) => (prev && safe.includes(prev) ? prev : safe[0] || null))
  }, [repo.path])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const loadEntries = useCallback(async () => {
    if (!activeFile) {
      setEntries([])
      return
    }
    const result = await api().read_env_file(repo.path, activeFile)
    setEntries(result?.entries || [])
    setRevealed(new Set())
    setDirty(false)
  }, [repo.path, activeFile])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  function updateEntry(index, field, value) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)))
    setDirty(true)
  }

  function removeEntry(index) {
    setEntries((prev) => prev.filter((_, i) => i !== index))
    setDirty(true)
  }

  function addEntry() {
    setEntries((prev) => [...prev, { key: '', value: '' }])
    setDirty(true)
  }

  function toggleReveal(index) {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function save() {
    const cleaned = entries.filter((e) => e.key.trim())
    const result = await api().write_env_file(repo.path, activeFile, cleaned)
    if (result?.error) onNotify(result.error, true)
    else {
      onNotify(`${activeFile} enregistré`)
      loadEntries()
    }
  }

  async function createFile() {
    await api().create_env_file(repo.path, '.env')
    onNotify('.env créé')
    loadFiles()
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Variables d'environnement</h3>
        {dirty && (
          <Button variant="primary" onClick={save}>
            Enregistrer
          </Button>
        )}
      </div>

      {files.length === 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
          <p className="text-xs text-muted">Aucun fichier .env détecté dans ce repo.</p>
          <Button variant="ghost" onClick={createFile}>
            <IconPlus className="h-3.5 w-3.5" />
            Créer .env
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFile(f)}
                className={`cursor-pointer rounded-md border px-2.5 py-1 font-mono text-[12px] transition-colors duration-150 ${
                  activeFile === f
                    ? 'border-accent bg-accent-bg text-accent'
                    : 'border-border text-muted hover:text-text hover:border-border-strong'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2">
            {entries.length === 0 && <p className="px-2 py-1 text-xs text-muted">Fichier vide.</p>}
            {entries.map((entry, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={entry.key}
                  onChange={(e) => updateEntry(i, 'key', e.target.value)}
                  placeholder="CLE"
                  title={entry.key}
                  className="w-64 shrink-0 rounded-md border border-border bg-base px-2 py-1.5 font-mono text-[12px] text-text outline-none focus:border-accent"
                />
                <input
                  type={revealed.has(i) ? 'text' : 'password'}
                  value={entry.value}
                  onChange={(e) => updateEntry(i, 'value', e.target.value)}
                  placeholder="valeur"
                  className="flex-1 rounded-md border border-border bg-base px-2 py-1.5 font-mono text-[12px] text-text outline-none focus:border-accent"
                />
                <button
                  onClick={() => toggleReveal(i)}
                  className="text-muted hover:text-text cursor-pointer"
                  title={revealed.has(i) ? 'Masquer' : 'Afficher'}
                >
                  {revealed.has(i) ? <IconEyeOff className="h-3.5 w-3.5" /> : <IconEye className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => removeEntry(i)} className="text-muted hover:text-danger cursor-pointer">
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <Button variant="ghost" className="self-start" onClick={addEntry}>
              <IconPlus className="h-3.5 w-3.5" />
              Ajouter une variable
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryPanel({ repo }) {
  const [commits, setCommits] = useState(null)
  const [limit, setLimit] = useState(50)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const result = await api().git_log(repo.path, limit)
    setCommits(result?.error ? [] : result?.commits || [])
  }, [repo.path, limit])

  useEffect(() => {
    load()
  }, [load])

  const filtered = (commits || []).filter((c) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.short.includes(q)
  })

  return (
    <div className="flex flex-col gap-2">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filtrer par message, auteur ou hash…"
        className="w-full rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
      />
      {commits === null ? (
        <p className="text-xs text-muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted">Aucun commit{search ? ` pour "${search}"` : ''}.</p>
      ) : (
        <div className="flex max-h-[28rem] flex-col overflow-y-auto rounded-lg border border-border bg-surface">
          {filtered.map((c) => (
            <div key={c.hash} className="flex items-start gap-2.5 border-b border-border px-2.5 py-2 text-[11px] last:border-b-0">
              <span className="mt-0.5 shrink-0 rounded bg-accent-bg px-1.5 py-0.5 font-mono text-[10px] text-accent">{c.short}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-text">{c.subject}</p>
                <p className="truncate font-mono text-[10px] text-muted">
                  {c.author} · {new Date(c.date).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      {commits && commits.length >= limit && (
        <Button variant="ghost" className="self-start" onClick={() => setLimit((l) => l + 50)}>
          Charger plus
        </Button>
      )}
    </div>
  )
}

function IgnorePanel({ repo, status, onNotify, onRefresh }) {
  const [presence, setPresence] = useState({})
  const [activeFile, setActiveFile] = useState('.gitignore')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [fileSearch, setFileSearch] = useState('')
  const [folderPattern, setFolderPattern] = useState('')
  const [ignoringFolder, setIgnoringFolder] = useState(false)
  const [confirmState, setConfirmState] = useState(null)

  const loadPresence = useCallback(async () => {
    const result = await api().list_ignore_files(repo.path)
    setPresence(result || {})
  }, [repo.path])

  useEffect(() => {
    loadPresence()
  }, [loadPresence])

  const loadContent = useCallback(async () => {
    const result = await api().read_ignore_file(repo.path, activeFile)
    setContent(result?.content || '')
    setDirty(false)
  }, [repo.path, activeFile])

  useEffect(() => {
    loadContent()
  }, [loadContent])

  async function save() {
    const result = await api().write_ignore_file(repo.path, activeFile, content)
    if (result?.error) onNotify(result.error, true)
    else {
      onNotify(`${activeFile} enregistré`)
      setDirty(false)
      loadPresence()
    }
  }

  async function applyIgnore(pattern, untrack, afterConfirm) {
    if (afterConfirm) setConfirmState(null)
    setIgnoringFolder(true)
    const result = await api().add_to_ignore(repo.path, '.gitignore', pattern, untrack)
    setIgnoringFolder(false)
    if (result?.error) onNotify(result.error, true)
    else {
      onNotify(`${pattern} ajouté à .gitignore`)
      setFolderPattern('')
      if (activeFile === '.gitignore') loadContent()
      onRefresh()
    }
  }

  // Tracked (already-committed) files need an actual `git rm --cached` on
  // top of the .gitignore entry — the pattern alone only hides untracked
  // files, so a modified tracked file would keep showing up otherwise.
  function ignoreFile(f) {
    const tracked = f.status !== '?'
    if (!tracked) {
      applyIgnore(f.path, false, false)
      return
    }
    setConfirmState({
      title: 'Retirer du suivi git ?',
      message: `"${f.path}" est déjà suivi par git.\n\nL'ignorer va aussi le retirer du suivi (git rm --cached) — le fichier reste sur le disque, mais ne sera plus commité.`,
      confirmLabel: 'Ignorer + détacher',
      onConfirm: () => applyIgnore(f.path, true, true),
    })
  }

  // For a whole flooded directory (e.g. a build cache with thousands of
  // files) clicking "Ignorer" file-by-file isn't realistic — one pattern
  // covers the lot, and add_to_ignore already runs `git rm --cached -r`
  // so untracking works the same way for a folder as for a single file.
  // A stray/typo'd pattern (a single letter, say) gives no visual clue
  // whether it matches nothing or half the repo — so the actual matches
  // are counted and shown before anything is touched.
  async function ignoreFolder() {
    const pattern = folderPattern.trim()
    if (!pattern) return
    setIgnoringFolder(true)
    const preview = await api().count_tracked_matches(repo.path, pattern)
    setIgnoringFolder(false)
    if (preview?.error) {
      onNotify(preview.error, true)
      return
    }
    if (!preview.count) {
      // Nothing tracked matches — just add the pattern, nothing to detach.
      applyIgnore(pattern, false, false)
      return
    }
    const sample = preview.sample.join('\n')
    const more = preview.count > preview.sample.length ? `\n… et ${preview.count - preview.sample.length} de plus` : ''
    setConfirmState({
      title: `Détacher ${preview.count} fichier(s) suivi(s) ?`,
      message: `"${pattern}" correspond à ${preview.count} fichier(s) déjà suivi(s) par git, par ex. :\n${sample}${more}\n\nIls seront ajoutés à .gitignore et retirés du suivi (git rm -r --cached). Ils restent sur le disque, juste plus commités.`,
      confirmLabel: 'Ignorer + détacher',
      onConfirm: () => applyIgnore(pattern, true, true),
    })
  }

  // Excludes .gitignore/.dockerignore themselves — ignoring the file that
  // does the ignoring is a no-op that mostly hides a file you actually want
  // committed, not a real cleanup action.
  const files = (status?.files || []).filter(
    (f) => f.status !== 'U' && !['.gitignore', '.dockerignore'].includes(f.path)
  )
  const filteredFiles = files.filter((f) => f.path.toLowerCase().includes(fileSearch.trim().toLowerCase()))

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex flex-wrap gap-2">
            {['.gitignore', '.dockerignore'].map((f) => (
              <button
                key={f}
                onClick={() => setActiveFile(f)}
                className={`cursor-pointer rounded-md border px-2.5 py-1 font-mono text-[12px] transition-colors duration-150 ${
                  activeFile === f
                    ? 'border-accent bg-accent-bg text-accent'
                    : 'border-border text-muted hover:text-text hover:border-border-strong'
                }`}
              >
                {f}
                {!presence[f] && <span className="ml-1 text-[10px] text-muted">(absent)</span>}
              </button>
            ))}
          </div>
          {dirty && (
            <Button variant="primary" onClick={save}>
              Enregistrer
            </Button>
          )}
        </div>
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            setDirty(true)
          }}
          placeholder={`${activeFile} vide`}
          rows={8}
          className="w-full resize-y rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
        />
        <div className="mt-2 flex gap-2">
          <input
            value={folderPattern}
            onChange={(e) => setFolderPattern(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ignoreFolder()}
            placeholder="ex: .angular/cache/ ou node_modules/ — ignore + détache tout d'un coup"
            className="flex-1 rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
          />
          <Button variant="ghost" disabled={ignoringFolder || !folderPattern.trim()} onClick={ignoreFolder}>
            {ignoringFolder ? 'Traitement…' : 'Ignorer + détacher'}
          </Button>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
            Fichiers non ignorés {files.length > 0 && `(${filteredFiles.length}/${files.length})`}
          </h3>
          {files.length > 8 && (
            <div className="relative w-56">
              <IconSearch className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
              <input
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder="Filtrer par chemin…"
                className="w-full rounded-md border border-border bg-base py-1 pl-6 pr-2 font-mono text-[11px] text-text outline-none focus:border-accent"
              />
            </div>
          )}
        </div>
        {files.length === 0 ? (
          <p className="text-xs text-muted">Rien à ignorer — l'arbre de travail est propre.</p>
        ) : filteredFiles.length === 0 ? (
          <p className="text-xs text-muted">Aucun fichier ne correspond à "{fileSearch}".</p>
        ) : (
          <div className="flex max-h-80 flex-col overflow-y-auto rounded-lg border border-border bg-surface">
            {filteredFiles.map((f) => (
              <div key={f.path} className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-[11px] last:border-b-0">
                <span
                  className={`w-5 shrink-0 text-center font-mono font-medium ${f.status === '?' ? 'text-success' : 'text-warning'}`}
                  title={f.status === '?' ? 'Nouveau fichier' : 'Modifié'}
                >
                  {f.status === '?' ? 'A' : 'M'}
                </span>
                <span className="flex-1 truncate font-mono text-muted">{f.path}</span>
                <button
                  onClick={() => ignoreFile(f)}
                  className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] text-text hover:border-border-strong hover:bg-surface-hover cursor-pointer"
                >
                  Ignorer
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  )
}

const CLI_PROVIDER_IDS = ['claude-code', 'codex', 'cli']

const ANSI = {
  reset: '\x1b[0m',
  red: '\x1b[1;31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  blue: '\x1b[1;34m',
  dim: '\x1b[90m',
}

const LOGBACK_LINE_RE = /^(\S+)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(\d+)\s+---\s+(\[[^\]]*\]\s+\[[^\]]*\])\s+(\S+)\s*:\s*(.*)$/
const LEVEL_COLOR = { TRACE: ANSI.dim, DEBUG: ANSI.dim, INFO: ANSI.cyan, WARN: ANSI.yellow, ERROR: ANSI.red }

function colorizeLine(line) {
  const m = line.match(LOGBACK_LINE_RE)
  if (m) {
    const [, ts, level, pid, brackets, logger, msg] = m
    const levelColor = LEVEL_COLOR[level] || ''
    return `${ANSI.dim}${ts}${ANSI.reset} ${levelColor}${level}${ANSI.reset} ${ANSI.dim}${pid} --- ${brackets}${ANSI.reset} ${ANSI.blue}${logger}${ANSI.reset} : ${msg}`
  }
  if (/\[ERROR\]|error:|exception|failed|failure/i.test(line)) {
    return `${ANSI.red}${line}${ANSI.reset}`
  }
  if (/\[WARN(ING)?\]/i.test(line)) {
    return `${ANSI.yellow}${line}${ANSI.reset}`
  }
  if (/\[INFO\]/.test(line)) {
    return `${ANSI.cyan}${line}${ANSI.reset}`
  }
  if (/build success|started \S+ in|successfully/i.test(line)) {
    return `${ANSI.green}${line}${ANSI.reset}`
  }
  return line
}

function colorizeChunk(data) {
  if (!data.includes('\n')) return colorizeLine(data)
  return data
    .split('\n')
    .map((line) => colorizeLine(line))
    .join('\n')
}

// Returns { ok, reason } instead of a bare boolean so callers can surface
// *why* a copy failed — the file:// origin + WebView2 combo fails silently
// enough that "it just doesn't work" was undebuggable without this.
async function copyText(text) {
  if (!text) return { ok: false, reason: 'rien à copier' }
  if (api()?.copy_to_clipboard) {
    const result = await api().copy_to_clipboard(text)
    if (result?.ok) return { ok: true }
    return { ok: false, reason: result?.error || 'échec du bridge natif' }
  }
  try {
    await navigator.clipboard.writeText(text)
    return { ok: true }
  } catch (e) {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok ? { ok: true } : { ok: false, reason: 'execCommand a refusé' }
    } catch (e2) {
      return { ok: false, reason: e2?.message || e?.message || 'toutes les méthodes ont échoué' }
    }
  }
}

// xterm.js needs real color values (not CSS variables) at construction time
// and on every theme switch, since its own <canvas> rendering is outside
// Tailwind/CSS's reach entirely.
function readTerminalThemeColors() {
  const style = getComputedStyle(document.documentElement)
  return {
    background: style.getPropertyValue('--color-base').trim() || '#0a0a0c',
    foreground: style.getPropertyValue('--color-text').trim() || '#d4d4d8',
  }
}

function PtyTerminal({ terminalId, startFn, onReady, onExited, onNotify, onUrlDetected, className, closeOnUnmount }) {
  const containerRef = useRef(null)
  const idRef = useRef(terminalId || null)
  const termRef = useRef(null)
  const searchAddonRef = useRef(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef(null)

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 12,
      theme: readTerminalThemeColors(),
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon
    termRef.current = term
    term.open(containerRef.current)
    fitAddon.fit()

    // xterm's built-in copyOnSelect relies on navigator.clipboard /
    // execCommand, both silently blocked under the app's file:// origin —
    // route selection-copy through the native clipboard bridge instead.
    term.onSelectionChange(() => {
      const selection = term.getSelection()
      if (!selection) return
      copyText(selection).then((result) => {
        if (!result.ok) onNotify?.(`Copie auto échouée : ${result.reason}`, true)
      })
    })

    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.key.toLowerCase() === 'f') {
        setSearchOpen((v) => !v)
        return false
      }
      if (e.type === 'keydown' && e.key === 'Escape') {
        setSearchOpen(false)
        return false
      }
      return true
    })

    term.onData((data) => {
      if (idRef.current) api().write_terminal(idRef.current, data)
    })

    let unsubscribe = null

    function attach(id) {
      idRef.current = id
      let ready = false
      let queued = []

      function writeChunk(data) {
        term.write(colorizeChunk(data))
        if (onUrlDetected) {
          const found = extractServerUrl(data)
          if (found) onUrlDetected(found)
        }
      }

      // Subscribe before fetching the backlog so nothing streamed while we're
      // fetching it gets silently dropped — just queue it and replay in order.
      unsubscribe = subscribeTerminal(
        id,
        (data) => {
          if (!ready) queued.push(data)
          else writeChunk(data)
        },
        () => term.write('\r\n\x1b[90m[session terminée]\x1b[0m\r\n')
      )

      api()
        .get_terminal_buffer(id)
        .then((buffer) => {
          if (buffer) writeChunk(buffer)
          queued.forEach(writeChunk)
          queued = []
          ready = true
          // The backlog can be huge and land in one big write — force the
          // viewport to the latest output instead of wherever it settled.
          term.scrollToBottom()
        })

      api().resize_terminal(id, term.rows, term.cols)
      onReady?.(id)
    }

    if (terminalId) {
      attach(terminalId)
    } else if (startFn) {
      startFn().then((result) => {
        if (result?.error) {
          onNotify?.(result.error, true)
          term.write(`\r\n\x1b[31mErreur: ${result.error}\x1b[0m\r\n`)
          onExited?.()
        } else {
          attach(result.terminal_id)
        }
      })
    }

    function handleResize() {
      fitAddon.fit()
      if (idRef.current) api().resize_terminal(idRef.current, term.rows, term.cols)
    }
    window.addEventListener('resize', handleResize)
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(containerRef.current)

    const themeObserver = new MutationObserver(() => {
      term.options.theme = readTerminalThemeColors()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      unsubscribe?.()
      if (closeOnUnmount && idRef.current) api().close_terminal(idRef.current)
      searchAddonRef.current = null
      termRef.current = null
      term.dispose()
    }
  }, [terminalId, startFn])

  function runSearch(query, backwards) {
    setSearchQuery(query)
    if (!query) return
    if (backwards) searchAddonRef.current?.findPrevious(query)
    else searchAddonRef.current?.findNext(query)
  }

  async function copySelection() {
    const selection = termRef.current?.getSelection()
    if (!selection) {
      onNotify?.('Sélectionne du texte dans le terminal avant de copier', true)
      return
    }
    const result = await copyText(selection)
    onNotify?.(result.ok ? 'Copié dans le presse-papier' : `Échec de la copie : ${result.reason}`, !result.ok)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={containerRef} className={className || 'flex-1 overflow-hidden bg-base p-2'} />
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <button
          onClick={copySelection}
          className="cursor-pointer rounded-md border border-border-strong bg-surface/90 p-1.5 text-muted shadow-lg hover:bg-surface-hover hover:text-text"
          title="Copier la sélection"
        >
          <IconCopy className="h-3.5 w-3.5" />
        </button>
        {searchOpen ? (
          <div className="flex items-center gap-1 rounded-md border border-border-strong bg-surface p-1 shadow-lg">
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => runSearch(e.target.value, false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch(searchQuery, e.shiftKey)
                if (e.key === 'Escape') setSearchOpen(false)
              }}
              placeholder="Rechercher…"
              className="w-40 rounded border border-border bg-base px-2 py-1 text-[11px] text-text outline-none focus:border-accent"
            />
            <button
              onClick={() => runSearch(searchQuery, true)}
              className="rounded px-1.5 py-1 text-[11px] text-muted hover:bg-surface-hover hover:text-text cursor-pointer"
              title="Précédent"
            >
              ↑
            </button>
            <button
              onClick={() => runSearch(searchQuery, false)}
              className="rounded px-1.5 py-1 text-[11px] text-muted hover:bg-surface-hover hover:text-text cursor-pointer"
              title="Suivant"
            >
              ↓
            </button>
            <button
              onClick={() => setSearchOpen(false)}
              className="rounded p-1 text-muted hover:bg-surface-hover hover:text-text cursor-pointer"
              title="Fermer"
            >
              <IconClose className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="cursor-pointer rounded-md border border-border-strong bg-surface/90 p-1.5 text-muted shadow-lg hover:bg-surface-hover hover:text-text"
            title="Rechercher (Ctrl+F)"
          >
            <IconSearch className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function EmbeddedTerminal({ repo, sessionId, onNotify, onBack }) {
  const startFn = useRef(() => api().start_terminal(repo.path, sessionId)).current

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[28rem] flex-col overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2">
        <Button variant="subtle" onClick={onBack} className="px-2">
          <IconChevronLeft className="h-4 w-4" />
          Retour
        </Button>
        <span className="text-xs text-muted">{repo.name}</span>
      </div>
      <PtyTerminal startFn={startFn} onNotify={onNotify} closeOnUnmount />
    </div>
  )
}

function AiSessionsPanel({ repo, onNotify }) {
  const [aiSettings, setAiSettings] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeSession, setActiveSession] = useState(undefined)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const settings = await api().get_ai_settings()
    setAiSettings(settings)
    if (settings?.provider === 'claude-code') {
      const list = await api().list_claude_sessions(repo.path)
      setSessions(Array.isArray(list) ? list : [])
    } else {
      setSessions([])
    }
    setLoading(false)
  }, [repo.path])

  useEffect(() => {
    load()
  }, [load])

  if (activeSession !== undefined) {
    return (
      <EmbeddedTerminal
        repo={repo}
        sessionId={activeSession}
        onNotify={onNotify}
        onBack={() => setActiveSession(undefined)}
      />
    )
  }

  if (loading) return <p className="text-xs text-muted">Chargement…</p>

  const isCli = CLI_PROVIDER_IDS.includes(aiSettings?.provider)

  if (!isCli) {
    return (
      <p className="text-xs text-muted">
        Configure un CLI (Claude Code, Codex, ou autre) dans Paramètres IA pour utiliser cette section.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          CLI actif : <span className="font-medium text-text">{IDE_LABELS[aiSettings.provider] || aiSettings.provider}</span>
        </span>
        <Button variant="primary" onClick={() => setActiveSession(null)}>
          <IconTerminal className="h-3.5 w-3.5" />
          Nouvelle session
        </Button>
      </div>

      {aiSettings.provider !== 'claude-code' ? (
        <p className="text-xs text-muted">
          Liste des sessions non disponible pour ce CLI — clique sur "Nouvelle session" pour l'ouvrir ici.
        </p>
      ) : sessions.length === 0 ? (
        <EmptyState message="Aucune session Claude Code trouvée pour ce repo." size="sm" />
      ) : (
        <>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une session…"
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
          />
          {(() => {
            const filtered = sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
            if (filtered.length === 0) {
              return <EmptyState message={`Aucune session ne correspond à "${search}".`} size="sm" />
            }
            return (
              <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-1.5">
                {filtered.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-surface-hover"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs text-text">{s.title}</p>
                      <p className="font-mono text-[10px] text-muted">{new Date(s.modified * 1000).toLocaleString()}</p>
                    </div>
                    <Button variant="ghost" onClick={() => setActiveSession(s.id)}>
                      Reprendre
                    </Button>
                  </div>
                ))}
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}

const DB_PAGE_SIZE = 50

const FILTER_OP_LABELS = {
  '=': '=',
  '!=': '≠',
  '>': '>',
  '<': '<',
  '>=': '≥',
  '<=': '≤',
  like: 'contient',
  'is null': 'est NULL',
  'is not null': "n'est pas NULL",
}

// Overlay scrollbar: the bar only appears while actually scrolling and fades
// out after a moment, instead of sitting there permanently. Pair with the
// .theme-scroll class, which styles the (otherwise transparent) thumb.
// Pull the dev server's address out of terminal output. Only local addresses
// count: tools print plenty of other links first (eas-cli leads with
// docs.expo.dev), and grabbing the first URL it saw was picking those.
function extractServerUrl(data) {
  const plain = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
  const matches = plain.match(/https?:\/\/[^\s"'\\<>]+/g)
  if (!matches) return null
  for (const raw of matches) {
    const candidate = raw.replace(/[.,;:)\]]+$/, '')
    let host
    try {
      host = new URL(candidate).hostname
    } catch {
      continue
    }
    const isLoopback = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)
    const isPrivateLan = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    if (!isLoopback && !isPrivateLan) continue
    // 0.0.0.0 means "all interfaces" — not something a browser can open.
    return candidate.replace('://0.0.0.0', '://localhost')
  }
  return null
}

function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')
  } catch {
    return false
  }
}

function useAutoHideScroll() {
  const ref = useRef(null)
  const timeout = useRef(null)

  useEffect(() => () => clearTimeout(timeout.current), [])

  function onScroll() {
    const el = ref.current
    if (!el) return
    el.classList.add('is-scrolling')
    clearTimeout(timeout.current)
    timeout.current = setTimeout(() => el.classList.remove('is-scrolling'), 900)
  }

  return { ref, onScroll }
}

// Native <select> popups render with the OS light chrome under WebView2
// regardless of our CSS color-scheme, so anywhere a select needs to match
// the dark theme goes through this custom dropdown instead.
function Select({ value, onChange, options, className, menuClassName, placeholder }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const current = options.find((o) => o.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          className ||
          'flex w-full cursor-pointer items-center justify-between gap-1 rounded-md border border-border bg-base px-2.5 py-1.5 text-[12px] text-text outline-none focus:border-accent'
        }
      >
        <span className="truncate">{current?.label ?? placeholder ?? value}</span>
        <IconChevronDown className="h-3 w-3 shrink-0 text-muted" />
      </button>
      {open && (
        <div
          className={
            menuClassName ||
            'absolute left-0 top-full z-20 mt-1 max-h-56 w-full min-w-max overflow-y-auto rounded-md border border-border-strong bg-surface shadow-lg'
          }
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`block w-full truncate px-2.5 py-1.5 text-left text-[12px] hover:bg-surface-hover cursor-pointer ${
                o.value === value ? 'text-accent' : 'text-text'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TypedInput({ column, value, onChange, className }) {
  if (column.family === 'bool') {
    return (
      <Select
        value={value ?? ''}
        onChange={onChange}
        placeholder={column.has_default ? '(défaut)' : column.nullable ? '(NULL)' : 'choisir…'}
        options={[
          { value: '', label: column.has_default ? '(défaut)' : column.nullable ? '(NULL)' : 'choisir…' },
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
        className={
          className ||
          'flex w-full cursor-pointer items-center justify-between gap-1 rounded-md border border-border bg-base px-2.5 py-1.5 text-[12px] text-text outline-none focus:border-accent'
        }
      />
    )
  }
  const type =
    column.family === 'int' || column.family === 'float'
      ? 'number'
      : column.family === 'date'
        ? 'date'
        : column.family === 'datetime'
          ? 'datetime-local'
          : 'text'
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={column.has_default ? '(défaut)' : column.nullable ? '(NULL)' : 'requis'}
      className={className || 'w-full rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-[12px] text-text outline-none focus:border-accent'}
    />
  )
}

function FilterValueInput({ value, onCommit }) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(local)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(local)
      }}
      placeholder="valeur"
      className="w-20 bg-transparent font-mono text-[11px] text-text outline-none"
    />
  )
}

function FilterBar({ columns, filters, onChange }) {
  function addFilter() {
    if (!columns.length) return
    onChange([...filters, { column: columns[0].name, op: '=', value: '' }])
  }
  function updateFilter(i, patch) {
    onChange(filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }
  function removeFilter(i) {
    onChange(filters.filter((_, idx) => idx !== i))
  }

  const compactSelect =
    'flex cursor-pointer items-center gap-1 bg-transparent px-1 py-0.5 text-[11px] text-text outline-none hover:bg-surface-hover rounded'
  const compactMenu =
    'absolute left-0 top-full z-20 mt-1 max-h-56 w-max overflow-y-auto rounded-md border border-border-strong bg-surface shadow-lg'

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
      {filters.map((f, i) => {
        const col = columns.find((c) => c.name === f.column)
        const needsValue = f.op !== 'is null' && f.op !== 'is not null'
        return (
          <div key={i} className="flex items-center gap-1 rounded-md border border-border bg-base px-1.5 py-1">
            <Select
              value={f.column}
              onChange={(v) => updateFilter(i, { column: v })}
              options={columns.map((c) => ({ value: c.name, label: c.name }))}
              className={compactSelect}
              menuClassName={compactMenu}
            />
            <Select
              value={f.op}
              onChange={(v) => updateFilter(i, { op: v })}
              options={Object.entries(FILTER_OP_LABELS).map(([op, label]) => ({ value: op, label }))}
              className={compactSelect}
              menuClassName={compactMenu}
            />
            {needsValue &&
              (col?.family === 'bool' ? (
                <Select
                  value={f.value}
                  onChange={(v) => updateFilter(i, { value: v })}
                  placeholder="valeur"
                  options={[
                    { value: 'true', label: 'true' },
                    { value: 'false', label: 'false' },
                  ]}
                  className={compactSelect}
                  menuClassName={compactMenu}
                />
              ) : (
                <FilterValueInput value={f.value} onCommit={(v) => updateFilter(i, { value: v })} />
              ))}
            <button onClick={() => removeFilter(i)} className="text-muted hover:text-danger cursor-pointer">
              <IconClose className="h-3 w-3" />
            </button>
          </div>
        )
      })}
      <button
        onClick={addFilter}
        disabled={!columns.length}
        className="flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        <IconPlus className="h-3 w-3" />
        Filtre
      </button>
    </div>
  )
}

function EditableCell({ value, column, editable, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [local, setLocal] = useState(value ?? '')
  const [saving, setSaving] = useState(false)

  const readOnlyClass =
    'max-w-[22rem] truncate whitespace-nowrap border-b border-r border-border px-3 py-1.5 font-mono text-[11px] text-text last:border-r-0'

  if (!editable || !column) {
    return (
      <td title={value === null ? 'NULL' : value} className={readOnlyClass}>
        {value === null ? <span className="italic text-muted">NULL</span> : value}
      </td>
    )
  }

  function cancel() {
    setLocal(value ?? '')
    setEditing(false)
  }

  async function confirm() {
    if (local === (value ?? '')) {
      setEditing(false)
      return
    }
    setSaving(true)
    await onCommit(local)
    setSaving(false)
    setEditing(false)
  }

  if (editing) {
    const input =
      column.family === 'bool' ? (
        <Select
          value={local}
          onChange={setLocal}
          options={[
            { value: 'true', label: 'true' },
            { value: 'false', label: 'false' },
          ]}
          className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-1 rounded border border-accent bg-base px-2 py-1 text-[11px] text-text outline-none"
        />
      ) : (
        <input
          autoFocus
          type={
            column.family === 'int' || column.family === 'float'
              ? 'number'
              : column.family === 'date'
                ? 'date'
                : column.family === 'datetime'
                  ? 'datetime-local'
                  : 'text'
          }
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirm()
            if (e.key === 'Escape') cancel()
          }}
          className="min-w-0 flex-1 rounded border border-accent bg-base px-2 py-1 font-mono text-[11px] text-text outline-none"
        />
      )
    return (
      <td className="border-b border-r border-border p-0.5 last:border-r-0">
        <div className="flex items-center gap-1">
          {input}
          <button
            onClick={confirm}
            disabled={saving}
            className="shrink-0 text-success hover:opacity-70 cursor-pointer disabled:opacity-40"
            title="Valider"
          >
            <IconCheck className="h-3.5 w-3.5" />
          </button>
          <button onClick={cancel} disabled={saving} className="shrink-0 text-muted hover:text-danger cursor-pointer" title="Annuler">
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    )
  }

  return (
    <td
      onClick={() => {
        setLocal(value ?? '')
        setEditing(true)
      }}
      title={value === null ? 'NULL — clic pour éditer' : `${value} — clic pour éditer`}
      className={`${readOnlyClass} cursor-text hover:bg-accent-bg`}
    >
      {value === null ? <span className="italic text-muted">NULL</span> : value}
    </td>
  )
}

function ResultTable({
  columns,
  rows,
  offset = 0,
  selectable,
  selected,
  onToggleRow,
  onToggleAll,
  draftRow,
  editable,
  onCellEdit,
  schemaByName,
}) {
  const pkIdx = selectable ? columns.findIndex((c) => c.is_pk) : -1
  const allSelected = selectable && rows.length > 0 && selected.size === rows.length
  const showLeadCol = selectable || !!draftRow

  return (
    <table className="w-full border-collapse text-left text-[12px]">
      <thead className="sticky top-0 z-10">
        <tr>
          {showLeadCol && (
            <th className="w-14 border-b border-r border-border bg-surface px-2 py-1.5">
              {selectable && <input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={pkIdx === -1} />}
            </th>
          )}
          <th className="w-12 border-b border-r border-border bg-surface px-2 py-1.5 text-[10px] font-normal text-muted">#</th>
          {columns.map((c) => (
            <th key={c.name} className="whitespace-nowrap border-b border-r border-border bg-surface px-3 py-1.5 last:border-r-0">
              <span className="font-mono text-[11px] font-medium text-text">{c.name}</span>
              {c.type && <span className="ml-1.5 font-mono text-[10px] text-muted">{c.type}</span>}
              {c.fk && (
                <span className="ml-1.5 rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">
                  → {c.fk.table}.{c.fk.column}
                </span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {draftRow && (
          <tr className="bg-accent-bg/40">
            <td className="border-b border-r border-border px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={draftRow.onSubmit}
                  disabled={draftRow.submitting}
                  className="text-success hover:opacity-70 cursor-pointer disabled:opacity-40"
                  title="Ajouter"
                >
                  <IconCheck className="h-3.5 w-3.5" />
                </button>
                <button onClick={draftRow.onCancel} className="text-muted hover:text-danger cursor-pointer" title="Annuler">
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              </div>
            </td>
            <td className="border-b border-r border-border px-2 py-1.5 text-right">
              <IconPlus className="ml-auto h-3 w-3 text-accent" />
            </td>
            {columns.map((c) => {
              const meta = schemaByName?.[c.name] || c
              return (
                <td key={c.name} className="border-b border-r border-border px-1.5 py-1 last:border-r-0">
                  <TypedInput column={meta} value={draftRow.values[c.name]} onChange={(v) => draftRow.onChange(c.name, v)} />
                </td>
              )
            })}
          </tr>
        )}
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length + 1 + (showLeadCol ? 1 : 0)} className="px-3 py-6 text-center text-[11px] text-muted">
              Aucun résultat.
            </td>
          </tr>
        ) : (
          rows.map((row, i) => {
            const pkValue = pkIdx >= 0 ? row[pkIdx] : null
            return (
              <tr key={i} className="hover:bg-surface-hover">
                {showLeadCol && (
                  <td className="border-b border-r border-border px-2 py-1.5">
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={pkValue !== null && selected.has(pkValue)}
                        onChange={() => onToggleRow(pkValue)}
                        disabled={pkValue === null}
                      />
                    )}
                  </td>
                )}
                <td className="border-b border-r border-border px-2 py-1.5 text-right font-mono text-[10px] text-muted">
                  {offset + i + 1}
                </td>
                {row.map((cell, j) => (
                  <EditableCell
                    key={j}
                    value={cell}
                    column={schemaByName?.[columns[j].name]}
                    editable={editable && pkValue !== null}
                    onCommit={(v) => onCellEdit(pkValue, columns[j].name, v)}
                  />
                ))}
              </tr>
            )
          })
        )}
      </tbody>
    </table>
  )
}


function DatabasePanel({ repo, onNotify }) {
  const [configOpen, setConfigOpen] = useState(false)
  const [detectKey, setDetectKey] = useState(0)
  const [status, setStatus] = useState('loading') // loading | not-found | error | ready
  const [connInfo, setConnInfo] = useState(null)
  const [connError, setConnError] = useState('')
  const [tables, setTables] = useState([])
  const [tableSearch, setTableSearch] = useState('')
  const [activeTable, setActiveTable] = useState(null)
  const [mode, setMode] = useState('browse') // browse | sql

  const [schema, setSchema] = useState(null)
  const [tableData, setTableData] = useState(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [tableError, setTableError] = useState('')
  const [offset, setOffset] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [filters, setFilters] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [insertOpen, setInsertOpen] = useState(false)
  const [insertValues, setInsertValues] = useState({})
  const [inserting, setInserting] = useState(false)

  const [sql, setSql] = useState('')
  const [sqlRunning, setSqlRunning] = useState(false)
  const [sqlResult, setSqlResult] = useState(null)
  const [sqlError, setSqlError] = useState('')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setActiveTable(null)
    api()
      .detect_database(repo.path)
      .then(async (result) => {
        if (cancelled) return
        if (!result?.found) {
          setStatus('not-found')
          return
        }
        setConnInfo(result)
        const tablesResult = await api().db_list_tables(repo.path)
        if (cancelled) return
        if (tablesResult?.error) {
          setConnError(tablesResult.error)
          setStatus('error')
          return
        }
        setTables(tablesResult.tables || [])
        setStatus('ready')
      })
    return () => {
      cancelled = true
    }
  }, [repo.path, detectKey])

  useEffect(() => {
    if (!activeTable) {
      setSchema(null)
      return
    }
    api()
      .db_table_schema(repo.path, activeTable)
      .then((r) => {
        if (!r?.error) setSchema(r)
      })
  }, [repo.path, activeTable])

  useEffect(() => {
    if (!activeTable || mode !== 'browse') {
      return
    }
    let cancelled = false
    setTableLoading(true)
    setTableError('')
    // Drop filters still missing a value (e.g. just added, or cleared) so we
    // never send an incomplete WHERE clause like active = '' to the DB.
    const effectiveFilters = filters.filter((f) => f.op === 'is null' || f.op === 'is not null' || (f.value ?? '') !== '')
    api()
      .db_read_table(repo.path, activeTable, DB_PAGE_SIZE, offset, effectiveFilters)
      .then((result) => {
        if (cancelled) return
        if (result?.error) {
          setTableError(result.error)
          setTableData(null)
        } else {
          setTableData(result)
        }
        setTableLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [repo.path, activeTable, offset, reloadKey, filters, mode])

  function selectTable(t) {
    setActiveTable(t)
    setMode('browse')
    setOffset(0)
    setFilters([])
    setSelected(new Set())
    setConfirmDelete(false)
    setInsertOpen(false)
    setInsertValues({})
  }

  function onConfigSaved() {
    setConfigOpen(false)
    setTableData(null)
    setDetectKey((k) => k + 1)
  }

  function startInsert() {
    setInsertValues({})
    setInsertOpen(true)
  }

  function cancelInsert() {
    setInsertOpen(false)
    setInsertValues({})
  }

  async function submitInsert() {
    setInserting(true)
    const result = await api().db_insert_row(repo.path, activeTable, insertValues)
    setInserting(false)
    if (result?.error) {
      onNotify(result.error, true)
      return
    }
    onNotify('Ligne ajoutée')
    setInsertOpen(false)
    setInsertValues({})
    setReloadKey((k) => k + 1)
  }

  async function updateCell(pkValue, columnName, value) {
    const result = await api().db_update_cell(repo.path, activeTable, columnName, value, tableData.pk_column, pkValue)
    if (result?.error) {
      onNotify(result.error, true)
      return
    }
    onNotify('Cellule mise à jour')
    setReloadKey((k) => k + 1)
  }

  function toggleRow(pkValue) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(pkValue)) next.delete(pkValue)
      else next.add(pkValue)
      return next
    })
  }

  function toggleAll() {
    if (!tableData) return
    setSelected((prev) => {
      if (prev.size === tableData.rows.length) return new Set()
      const pkIdx = tableData.columns.findIndex((c) => c.is_pk)
      if (pkIdx === -1) return prev
      return new Set(tableData.rows.map((r) => r[pkIdx]))
    })
  }

  async function deleteSelected() {
    setDeleting(true)
    const result = await api().db_delete_rows(repo.path, activeTable, [...selected])
    setDeleting(false)
    setConfirmDelete(false)
    if (result?.error) {
      onNotify(result.error, true)
      return
    }
    onNotify(`${result.deleted} ligne(s) supprimée(s)`)
    setSelected(new Set())
    setReloadKey((k) => k + 1)
  }

  async function runSql() {
    setSqlRunning(true)
    setSqlError('')
    const result = await api().db_run_query(repo.path, sql)
    setSqlRunning(false)
    if (result?.error) {
      setSqlError(result.error)
      setSqlResult(null)
      onNotify('Erreur SQL', true)
      return
    }
    setSqlResult(result)
    onNotify(result.message || `${result.rows?.length ?? 0} ligne(s) retournée(s)`)
  }

  if (status === 'loading') {
    return <p className="text-xs text-muted">Détection de la base de données…</p>
  }

  if (status === 'not-found') {
    return (
      <div className="flex flex-col items-center gap-3">
        <EmptyState message="Aucune base de données détectée (.env, config Spring, Prisma, ou fichier SQLite)." />
        {configOpen ? (
          <div className="w-72">
            <DbConfigForm repo={repo} info={connInfo} onSaved={onConfigSaved} onCancel={() => setConfigOpen(false)} onNotify={onNotify} />
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setConfigOpen(true)}>
            <IconSettings className="h-3.5 w-3.5" />
            Configurer manuellement
          </Button>
        )}
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col gap-2">
        <ConnectionBadge info={connInfo} />
        <div className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-xs text-danger">{connError}</div>
        {configOpen ? (
          <div className="w-72">
            <DbConfigForm repo={repo} info={connInfo} onSaved={onConfigSaved} onCancel={() => setConfigOpen(false)} onNotify={onNotify} />
          </div>
        ) : (
          <Button variant="ghost" className="self-start" onClick={() => setConfigOpen(true)}>
            <IconSettings className="h-3.5 w-3.5" />
            Configurer la connexion
          </Button>
        )}
      </div>
    )
  }

  const filteredTables = tables.filter((t) => t.toLowerCase().includes(tableSearch.trim().toLowerCase()))
  const from = tableData?.total ? offset + 1 : 0
  const to = Math.min(offset + DB_PAGE_SIZE, tableData?.total || 0)
  const canSelect = !!tableData?.pk_column
  const isSql = connInfo.engine !== 'mongo'

  return (
    <div className="flex h-[36rem] overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--card-shadow)]">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border">
        <div className="flex min-h-[57px] items-center border-b border-border p-2.5">
          <div className="flex w-full items-start justify-between gap-2">
            <ConnectionBadge info={connInfo} />
            <button
              onClick={() => setConfigOpen(true)}
              className="shrink-0 text-muted hover:text-text cursor-pointer"
              title="Configurer la connexion"
            >
              <IconSettings className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {configOpen && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfigOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xs">
              <DbConfigForm repo={repo} info={connInfo} onSaved={onConfigSaved} onCancel={() => setConfigOpen(false)} onNotify={onNotify} />
            </div>
          </div>
        )}

        {isSql && (
          <div className="flex h-10 border-b border-border">
            <button
              onClick={() => setMode('browse')}
              className={`flex flex-1 cursor-pointer items-center justify-center border-b-2 px-2 text-[11px] font-medium transition-colors duration-150 ${
                mode === 'browse' ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              Tables
            </button>
            <button
              onClick={() => setMode('sql')}
              className={`flex flex-1 cursor-pointer items-center justify-center border-b-2 px-2 text-[11px] font-medium transition-colors duration-150 ${
                mode === 'sql' ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              SQL
            </button>
          </div>
        )}

        <div className="border-b border-border p-2">
          <input
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="Rechercher une table…"
            className="w-full rounded-md border border-border bg-base px-2.5 py-1.5 text-[11px] text-text outline-none focus:border-accent"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted">
            {connInfo.engine === 'mongo' ? 'Collections' : 'Tables'} ({filteredTables.length})
          </p>
          {filteredTables.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted">Aucun résultat.</p>
          ) : (
            filteredTables.map((t) => (
              <button
                key={t}
                onClick={() => selectTable(t)}
                className={`flex w-full items-center gap-1.5 truncate rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors duration-150 ${
                  activeTable === t && mode === 'browse' ? 'bg-accent-bg text-accent' : 'text-muted hover:bg-surface-hover hover:text-text'
                }`}
              >
                <IconTable className="h-3 w-3 shrink-0" />
                <span className="truncate">{t}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {mode === 'sql' ? (
          <>
            <div className="flex min-h-[57px] items-center justify-between gap-3 border-b border-border px-3 py-2">
              <span className="text-[13px] font-medium text-text">Éditeur SQL</span>
              <Button variant="primary" onClick={runSql} disabled={sqlRunning || !sql.trim()}>
                {sqlRunning ? 'Exécution…' : 'Exécuter'}
              </Button>
            </div>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runSql()
              }}
              placeholder="SELECT * FROM ma_table WHERE ...  (Ctrl+Entrée pour exécuter)"
              spellCheck={false}
              className="h-32 shrink-0 resize-none border-b border-border bg-base p-3 font-mono text-[12px] text-text outline-none"
            />
            <div className="min-h-0 flex-1 overflow-auto">
              {sqlError ? (
                <div className="m-3 rounded-lg border border-danger/30 bg-danger-bg p-3 text-xs text-danger">{sqlError}</div>
              ) : sqlResult?.rows ? (
                <>
                  <ResultTable columns={sqlResult.columns} rows={sqlResult.rows} selectable={false} />
                  {sqlResult.truncated && (
                    <p className="p-2 text-center text-[11px] text-muted">Résultat tronqué à 500 lignes.</p>
                  )}
                </>
              ) : sqlResult?.message ? (
                <p className="p-4 text-xs text-success">{sqlResult.message}</p>
              ) : (
                <div className="flex h-full items-center justify-center p-6">
                  <EmptyState message="Écris une requête et exécute-la (Ctrl+Entrée)." size="sm" />
                </div>
              )}
            </div>
          </>
        ) : !activeTable ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState message={`Choisis une ${connInfo.engine === 'mongo' ? 'collection' : 'table'} à gauche.`} size="sm" />
          </div>
        ) : (
          <>
            <div className="flex min-h-[57px] items-center justify-between gap-3 border-b border-border px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[13px] font-medium text-text">{activeTable}</span>
                {tableData && (
                  <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-muted">
                    {tableData.total} ligne{tableData.total > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selected.size > 0 && !confirmDelete && (
                  <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                    <IconTrash className="h-3.5 w-3.5" />
                    Supprimer ({selected.size})
                  </Button>
                )}
                {confirmDelete && (
                  <div className="flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger-bg px-2 py-1 text-[11px] text-danger">
                    <span>Confirmer la suppression de {selected.size} ligne(s) ?</span>
                    <button onClick={() => setConfirmDelete(false)} className="cursor-pointer underline">
                      Annuler
                    </button>
                    <button onClick={deleteSelected} disabled={deleting} className="cursor-pointer font-medium underline">
                      {deleting ? '…' : 'Confirmer'}
                    </button>
                  </div>
                )}
                {schema && !insertOpen && (
                  <Button variant="ghost" onClick={startInsert}>
                    <IconPlus className="h-3.5 w-3.5" />
                    Ligne
                  </Button>
                )}
                <button onClick={() => setReloadKey((k) => k + 1)} className="text-muted hover:text-text cursor-pointer" title="Actualiser">
                  <IconRefresh className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {schema && <FilterBar columns={schema.columns} filters={filters} onChange={(f) => { setFilters(f); setOffset(0) }} />}

            {tableLoading ? (
              <p className="p-4 text-xs text-muted">Chargement…</p>
            ) : tableError ? (
              <div className="m-3 rounded-lg border border-danger/30 bg-danger-bg p-3 text-xs text-danger">{tableError}</div>
            ) : tableData ? (
              <>
                <div className="min-h-0 flex-1 overflow-auto">
                  <ResultTable
                    columns={tableData.columns}
                    rows={tableData.rows}
                    offset={offset}
                    selectable={canSelect}
                    selected={selected}
                    onToggleRow={toggleRow}
                    onToggleAll={toggleAll}
                    editable={canSelect}
                    onCellEdit={updateCell}
                    schemaByName={schema ? Object.fromEntries(schema.columns.map((c) => [c.name, c])) : undefined}
                    draftRow={
                      insertOpen && schema
                        ? {
                            values: insertValues,
                            onChange: (name, v) => setInsertValues((s) => ({ ...s, [name]: v })),
                            onSubmit: submitInsert,
                            onCancel: cancelInsert,
                            submitting: inserting,
                          }
                        : null
                    }
                  />
                </div>

                <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-muted">
                  <span>
                    {from}–{to} sur {tableData.total}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - DB_PAGE_SIZE))}>
                      Précédent
                    </Button>
                    <Button variant="ghost" disabled={offset + DB_PAGE_SIZE >= tableData.total} onClick={() => setOffset((o) => o + DB_PAGE_SIZE)}>
                      Suivant
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

const DB_ENGINES = [
  { id: 'postgres', label: 'PostgreSQL', port: 5432 },
  { id: 'mysql', label: 'MySQL / MariaDB', port: 3306 },
  { id: 'sqlite', label: 'SQLite' },
  { id: 'mongo', label: 'MongoDB' },
]

function DbConfigForm({ repo, info, onSaved, onCancel, onNotify }) {
  const preset = info?.manual ? info : null
  const [engine, setEngine] = useState(preset?.engine || info?.engine || 'postgres')
  const [host, setHost] = useState(preset?.host || '')
  const [port, setPort] = useState(preset?.port ? String(preset.port) : '')
  const [database, setDatabase] = useState(preset?.engine === 'sqlite' ? '' : preset?.database || '')
  const [user, setUser] = useState(preset?.user || '')
  const [password, setPassword] = useState('')
  const [file, setFile] = useState(preset?.file || '')
  const [uri, setUri] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const input = 'rounded-md border border-border bg-base px-2.5 py-1.5 text-[11px] text-text outline-none focus:border-accent'

  function currentCfg() {
    return { engine, host, port: port || undefined, database, user, password, file, uri }
  }

  async function test() {
    setTesting(true)
    setTestResult(null)
    const result = await api().test_db_config(repo.path, currentCfg())
    setTestResult(result)
    setTesting(false)
  }

  async function save() {
    setSaving(true)
    const result = await api().save_db_config(repo.path, {
      engine,
      host,
      port: port || undefined,
      database,
      user,
      password,
      file,
      uri,
    })
    setSaving(false)
    if (result?.error) {
      onNotify(result.error, true)
      return
    }
    onNotify('Connexion enregistrée')
    onSaved()
  }

  async function resetToAuto() {
    await api().clear_db_config(repo.path)
    onNotify('Configuration manuelle supprimée — retour à la détection auto')
    onSaved()
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-text">Connexion manuelle</span>
        <button onClick={onCancel} className="text-muted hover:text-text cursor-pointer" title="Annuler">
          <IconClose className="h-3.5 w-3.5" />
        </button>
      </div>

      <Select
        value={engine}
        onChange={setEngine}
        options={DB_ENGINES.map((e) => ({ value: e.id, label: e.label }))}
        className={`${input} flex w-full min-w-0 cursor-pointer items-center justify-between`}
      />

      {engine === 'sqlite' ? (
        <input value={file} onChange={(e) => setFile(e.target.value)} placeholder="Chemin du fichier .db" className={`${input} w-full min-w-0 font-mono`} />
      ) : engine === 'mongo' ? (
        <input
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder={preset?.engine === 'mongo' ? 'URI enregistrée — laisser vide' : 'mongodb://user:pass@host:27017/base'}
          className={`${input} w-full min-w-0 font-mono`}
        />
      ) : (
        <>
          <div className="flex min-w-0 gap-2">
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Hôte" className={`${input} min-w-0 flex-1 font-mono`} />
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder={String(DB_ENGINES.find((e) => e.id === engine)?.port || '')}
              className={`${input} w-16 shrink-0 font-mono`}
            />
          </div>
          <input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="Base" className={`${input} w-full min-w-0 font-mono`} />
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Utilisateur" className={`${input} w-full min-w-0 font-mono`} />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={info?.has_password ? 'Mot de passe (inchangé)' : 'Mot de passe'}
            className={`${input} w-full min-w-0 font-mono`}
          />
        </>
      )}

      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={test} disabled={testing || saving}>
          {testing ? 'Test…' : 'Tester la connexion'}
        </Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
        {info?.manual && (
          <Button variant="ghost" onClick={resetToAuto}>
            Détection auto
          </Button>
        )}
      </div>
      {testResult && (
        <span className={`flex items-center gap-1 text-[11px] ${testResult.ok ? 'text-success' : 'text-danger'}`}>
          {testResult.ok ? <IconCheck className="h-3 w-3" /> : <IconAlertCircle className="h-3 w-3" />}
          {testResult.ok ? 'Connexion réussie' : testResult.error}
        </span>
      )}
    </div>
  )
}

function ConnectionBadge({ info }) {
  if (!info) return null
  const target =
    info.engine === 'sqlite'
      ? info.database
      : info.engine === 'mongo'
        ? `${info.host}/${info.database}`
        : `${info.host}:${info.port}/${info.database}`
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="w-fit rounded-full bg-accent-bg px-2 py-0.5 font-mono text-[10px] text-accent">
          {info.label}
        </span>
        {info.manual && (
          <span className="w-fit rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">manuel</span>
        )}
      </div>
      <span className="truncate font-mono text-[10px] text-muted" title={target}>
        {target}
      </span>
    </div>
  )
}

function RunPanel({ repo, runningConfigs, onStart, onStop, onClear, onNotify }) {
  const chipsScroll = useAutoHideScroll()
  const [configs, setConfigs] = useState([])
  const [selected, setSelected] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingName, setEditingName] = useState(null)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const [envText, setEnvText] = useState('')
  const [activeRunName, setActiveRunName] = useState(null)
  const [runTabOrder, setRunTabOrder] = useState([])
  const [dragRunName, setDragRunName] = useState(null)

  const runningNamesKey = Object.keys(runningConfigs).sort().join(',')

  // Same pattern as the Processus tab reordering: keep the running-configs
  // tab strip in sync (new run → appended tab, stopped+cleared → dropped)
  // without discarding whatever order the user dragged them into.
  useEffect(() => {
    const runningNames = runningNamesKey ? runningNamesKey.split(',') : []
    setRunTabOrder((prev) => {
      const stillRunning = prev.filter((n) => runningNames.includes(n))
      const newOnes = runningNames.filter((n) => !stillRunning.includes(n))
      return [...stillRunning, ...newOnes]
    })
    setActiveRunName((prev) => (prev && runningNames.includes(prev) ? prev : runningNames[runningNames.length - 1] || null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningNamesKey])

  async function startConfig(cfgName) {
    const cfg = configs.find((c) => c.name === cfgName)
    const result = await onStart(repo.path, cfgName, cfg?.url)
    if (!result?.error) setActiveRunName(cfgName)
  }

  const loadConfigs = useCallback(async () => {
    const list = await api().list_run_configs(repo.path)
    const safe = Array.isArray(list) ? list : []
    setConfigs(safe)
    setSelected((prev) => prev || safe[0]?.name || null)
  }, [repo.path])

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  function parseEnv(text) {
    const env = {}
    text.split('\n').forEach((line) => {
      const idx = line.indexOf('=')
      if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    })
    return env
  }

  const original = useRef({ name: '', command: '', url: '', envText: '' })

  function resetForm() {
    setEditingName(null)
    setName('')
    setCommand('')
    setUrl('')
    setEnvText('')
    original.current = { name: '', command: '', url: '', envText: '' }
    setFormOpen(false)
  }

  function editConfig(cfg) {
    const envText = Object.entries(cfg.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')
    setEditingName(cfg.name)
    setName(cfg.name)
    setCommand(cfg.command)
    setUrl(cfg.url || '')
    setEnvText(envText)
    // Snapshot so Annuler can restore, and so we can tell whether anything
    // actually changed before warning about discarding.
    original.current = { name: cfg.name, command: cfg.command, url: cfg.url || '', envText }
    setFormOpen(true)
  }

  const isDirty =
    name !== original.current.name ||
    command !== original.current.command ||
    url !== original.current.url ||
    envText !== original.current.envText

  function cancelForm() {
    if (isDirty && !window.confirm('Annuler les modifications non enregistrées ?')) return
    resetForm()
  }

  async function saveConfig() {
    if (!name.trim() || !command.trim()) return
    const trimmedName = name.trim()
    const result = await api().save_run_config(repo.path, trimmedName, command.trim(), parseEnv(envText), url.trim())
    if (result?.error) onNotify(result.error, true)
    else {
      if (editingName && editingName !== trimmedName) {
        await api().delete_run_config(repo.path, editingName)
      }
      onNotify(`Config "${trimmedName}" enregistrée`)
      setSelected(trimmedName)
      resetForm()
      loadConfigs()
    }
  }

  async function deleteConfig(cfgName) {
    await api().delete_run_config(repo.path, cfgName)
    if (selected === cfgName) setSelected(null)
    onNotify(`Commande "${cfgName}" supprimée`)
    loadConfigs()
  }

  async function setDefaultConfig(cfgName) {
    const result = await api().set_default_run_config(repo.path, cfgName)
    if (result?.error) onNotify(result.error, true)
    else onNotify(`"${cfgName}" est maintenant la commande principale`)
    loadConfigs()
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Run</h3>
        <Button variant="ghost" onClick={() => (formOpen ? resetForm() : setFormOpen(true))}>
          <IconPlus className="h-3.5 w-3.5" />
          Nouvelle commande
        </Button>
      </div>

      {formOpen && (
        <div className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          {editingName && <span className="text-[11px] text-muted">Édition de "{editingName}"</span>}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom (ex: dev)"
            className="rounded-md border border-border bg-base px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
          />
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Commande (ex: npm run dev)"
            className="rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL (optionnel — ex: http://localhost:3000)"
            className="rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
          />
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder={"Variables d'env (une par ligne, KEY=VALUE)"}
            rows={3}
            className="resize-none rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={saveConfig}>
              Enregistrer
            </Button>
            <Button variant="ghost" onClick={cancelForm}>
              Annuler
            </Button>
            {isDirty && <span className="text-[11px] text-muted">modifications non enregistrées</span>}
          </div>
        </div>
      )}

      {configs.length === 0 ? (
        <EmptyState message="Aucune commande configurée." size="sm" />
      ) : (
        <div className="flex flex-col gap-3">
          <div ref={chipsScroll.ref} onScroll={chipsScroll.onScroll} className="theme-scroll flex items-center gap-2 overflow-x-auto pb-1">
            {configs.map((c) => {
              const run = runningConfigs[c.name]
              return (
                <div key={c.name} className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => {
                      setSelected(c.name)
                      if (run) setActiveRunName(c.name)
                    }}
                    title={c.command}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[12px] transition-colors duration-150 ${
                      selected === c.name
                        ? 'border-accent bg-accent-bg text-accent'
                        : 'border-border text-muted hover:text-text hover:border-border-strong'
                    }`}
                  >
                    {run?.running && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
                    {c.name}
                  </button>
                  <button
                    onClick={() => setDefaultConfig(c.name)}
                    className={`cursor-pointer ${c.default ? 'text-warning' : 'text-muted hover:text-text'}`}
                    title={c.default ? 'Commande principale du projet' : 'Définir comme commande principale'}
                  >
                    <IconStar className="h-3 w-3" filled={c.default} />
                  </button>
                  <button
                    onClick={() => editConfig(c)}
                    className="text-muted hover:text-text cursor-pointer"
                    title="Modifier cette commande"
                  >
                    <IconPencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => deleteConfig(c.name)}
                    className="text-muted hover:text-danger cursor-pointer"
                    title="Supprimer cette commande"
                  >
                    <IconTrash className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>

          {(() => {
            const selectedRun = selected ? runningConfigs[selected] : null
            return (
              <div className="flex items-center gap-2">
                {selectedRun?.running ? (
                  <Button variant="danger" onClick={() => onStop(repo.path, selected)} className="border border-danger/40">
                    <IconClose className="h-3.5 w-3.5" />
                    Stop
                  </Button>
                ) : (
                  <Button variant="primary" disabled={!selected} onClick={() => startConfig(selected)}>
                    <IconExternal className="h-3.5 w-3.5" />
                    {selectedRun ? 'Relancer' : 'Run'}{selected ? ` ${selected}` : ''}
                  </Button>
                )}
                {selectedRun?.running && <span className="text-[11px] text-success">en cours…</span>}
                {selectedRun && !selectedRun.running && (
                  <span className="text-[11px] text-muted">arrêté — logs conservés</span>
                )}
                {selectedRun && (
                  <Button
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => onClear(selectedRun.key)}
                    disabled={selectedRun.running}
                    title={selectedRun.running ? 'Stoppe le process avant de nettoyer' : 'Effacer les logs'}
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                    Nettoyer
                  </Button>
                )}
              </div>
            )
          })()}

          {runTabOrder.filter((n) => runningConfigs[n]).length > 1 && (
            <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
              {runTabOrder
                .filter((n) => runningConfigs[n])
                .map((n) => (
                  <div
                    key={n}
                    draggable
                    onDragStart={() => setDragRunName(n)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (!dragRunName || dragRunName === n) return
                      const order = runTabOrder.filter((x) => runningConfigs[x])
                      const from = order.indexOf(dragRunName)
                      const to = order.indexOf(n)
                      order.splice(from, 1)
                      order.splice(to, 0, dragRunName)
                      setRunTabOrder(order)
                      setDragRunName(null)
                    }}
                    onDragEnd={() => setDragRunName(null)}
                    onClick={() => {
                      setActiveRunName(n)
                      setSelected(n)
                    }}
                    className={`flex shrink-0 cursor-grab items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors duration-150 active:cursor-grabbing ${
                      dragRunName === n ? 'opacity-40' : ''
                    } ${activeRunName === n ? 'bg-accent-bg text-accent' : 'text-muted hover:bg-surface-hover hover:text-text'}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    {n}
                  </div>
                ))}
            </div>
          )}

          {activeRunName && runningConfigs[activeRunName] ? (
            <PtyTerminal
              key={runningConfigs[activeRunName].terminalId}
              terminalId={runningConfigs[activeRunName].terminalId}
              onNotify={onNotify}
              className="h-[32rem] overflow-hidden rounded-lg border border-border bg-base p-2"
            />
          ) : (
            <EmptyState
              className="h-[32rem] bg-base"
              message='Clique sur "Run" pour démarrer — le terminal est interactif (tape directement dedans).'
            />
          )}
        </div>
      )}
    </div>
  )
}

function ConflictResolverModal({ path, file, onClose, onSaved, onNotify }) {
  const [loading, setLoading] = useState(true)
  const [ours, setOurs] = useState(null)
  const [theirs, setTheirs] = useState(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    api()
      .get_conflict_versions(path, file)
      .then((result) => {
        if (cancelled) return
        if (result?.error) {
          onNotify(result.error, true)
          onClose()
          return
        }
        setOurs(result.ours)
        setTheirs(result.theirs)
        setContent(result.current || '')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path, file])

  async function save() {
    setSaving(true)
    const result = await api().save_conflict_resolution(path, file, content)
    if (result?.error) onNotify(result.error, true)
    else {
      onNotify(`${file} résolu`)
      onSaved()
      onClose()
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-base">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="truncate font-mono text-sm text-text">{file}</span>
        <button onClick={onClose} className="text-muted hover:text-text cursor-pointer">
          <IconClose className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">Chargement…</div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden border-b border-border">
            <div className="flex w-1/2 flex-col border-r border-border">
              <div className="border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
                Actuel (HEAD)
              </div>
              <pre className="flex-1 overflow-auto whitespace-pre-wrap bg-base p-3 font-mono text-[11px] text-text">
                {ours ?? '(fichier absent de cette version)'}
              </pre>
            </div>
            <div className="flex w-1/2 flex-col">
              <div className="border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
                Entrant (pull)
              </div>
              <pre className="flex-1 overflow-auto whitespace-pre-wrap bg-base p-3 font-mono text-[11px] text-text">
                {theirs ?? '(fichier absent de cette version)'}
              </pre>
            </div>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                Résultat (à éditer et enregistrer)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={ours === null}
                  onClick={() => setContent(ours || '')}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-text hover:border-border-strong hover:bg-surface-hover disabled:opacity-40 cursor-pointer"
                >
                  Utiliser la mienne
                </button>
                <button
                  disabled={theirs === null}
                  onClick={() => setContent(theirs || '')}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-text hover:border-border-strong hover:bg-surface-hover disabled:opacity-40 cursor-pointer"
                >
                  Utiliser la leur
                </button>
                <button
                  onClick={() => setContent(`${ours || ''}\n${theirs || ''}`)}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-text hover:border-border-strong hover:bg-surface-hover cursor-pointer"
                >
                  Garder les deux
                </button>
              </div>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="flex-1 resize-none bg-base p-3 font-mono text-[11px] text-text outline-none"
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" onClick={onClose}>
          Annuler
        </Button>
        <Button variant="primary" disabled={loading || saving} onClick={save}>
          Enregistrer et marquer résolu
        </Button>
      </div>
    </div>
  )
}

function ConflictPanel({ path, conflicted, onOpenIde, onNotify, onRefresh }) {
  const [busy, setBusy] = useState(false)
  const [resolvingFile, setResolvingFile] = useState(null)

  async function markResolved(file) {
    setBusy(true)
    const result = await api().mark_resolved(path, file)
    if (result?.error) onNotify(result.error, true)
    else onNotify(`${file} marqué résolu`)
    await onRefresh()
    setBusy(false)
  }

  async function abort() {
    setBusy(true)
    const result = await api().abort_merge(path)
    if (result?.error) onNotify(result.error, true)
    else onNotify('Merge annulé')
    await onRefresh()
    setBusy(false)
  }

  return (
    <div className="rounded-lg border border-danger/40 bg-danger-bg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-danger">
          Conflit sur {conflicted.length} fichier{conflicted.length > 1 ? 's' : ''}
        </h3>
        <Button variant="ghost" disabled={busy} onClick={abort}>
          Annuler le merge
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted">
        Résous chaque fichier ici, ou dans l'IDE puis marque-le résolu. Une fois tous résolus, valide un commit
        pour terminer le merge.
      </p>
      <div className="flex flex-col gap-1.5">
        {conflicted.map((file) => (
          <div key={file} className="flex items-center justify-between rounded-md bg-base/60 px-3 py-2">
            <span className="truncate font-mono text-xs text-text">{file}</span>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => onOpenIde(path)}
                className="text-[11px] text-muted hover:text-text cursor-pointer"
              >
                Ouvrir dans l'IDE
              </button>
              <Button variant="ghost" disabled={busy} onClick={() => setResolvingFile(file)}>
                Résoudre ici
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => markResolved(file)}>
                Marquer résolu
              </Button>
            </div>
          </div>
        ))}
      </div>

      {resolvingFile && (
        <ConflictResolverModal
          path={path}
          file={resolvingFile}
          onClose={() => setResolvingFile(null)}
          onSaved={onRefresh}
          onNotify={onNotify}
        />
      )}
    </div>
  )
}

function RepoDetail({ repo, ides, terminals, runningConfigs, onStartRun, onStopRun, onClearRun, onBack, onRefreshList, onNotify }) {
  const [status, setStatus] = useState(repo.status)
  const [branches, setBranches] = useState([])
  const [loadingBranches, setLoadingBranches] = useState(true)
  const [busy, setBusy] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [ide, setIde] = useState(repo.ide)
  const [commitOpen, setCommitOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genLanguage, setGenLanguage] = useState('auto')

  useEffect(() => {
    api()
      ?.get_ai_settings()
      ?.then((s) => s?.commit_language && setGenLanguage(s.commit_language))
  }, [])
  const [activeTab, setActiveTab] = useState('branches')
  // Tabs stay mounted once visited so switching away and back doesn't wipe
  // their state, but tabs never opened (e.g. BDD, which connects to a real
  // remote DB on mount) aren't rendered eagerly.
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(['branches']))
  useEffect(() => {
    setVisitedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)))
  }, [activeTab])

  async function generateCommitMessage() {
    setGenerating(true)
    const result = await api().generate_commit_message(repo.path, genLanguage)
    if (result?.error) onNotify(result.error, true)
    else setMessage(result.message)
    setGenerating(false)
  }

  const loadAll = useCallback(async () => {
    setLoadingBranches(true)
    const [freshStatus, branchList] = await Promise.all([
      api().git_status(repo.path),
      api().branches(repo.path),
    ])
    setStatus(freshStatus)
    setBranches(Array.isArray(branchList) ? branchList : [])
    setLoadingBranches(false)
    onRefreshList()
  }, [repo.path, onRefreshList])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  async function run(action, label) {
    setBusy(true)
    try {
      const result = await action()
      if (result?.error) onNotify(`${label} : ${result.error}`, true)
      else onNotify(`${label} OK`)
      await loadAll()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Button variant="subtle" onClick={onBack} className="mt-0.5 px-2" title="Retour">
            <IconChevronLeft className="h-4 w-4" />
          </Button>
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-bg text-accent">
            <IconFolder className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text">{repo.name}</h2>
            <p className="truncate font-mono text-xs text-muted">{repo.path}</p>
          </div>
        </div>
        <Button variant="subtle" onClick={loadAll} title="Recharger l'état git (utile si modifié hors de Dev Hub)">
          <IconRefresh className="h-3.5 w-3.5" />
          Rafraîchir
        </Button>
      </div>

      {status?.conflicted?.length > 0 && (
        <ConflictPanel
          path={repo.path}
          conflicted={status.conflicted}
          onOpenIde={async (p) => {
            const result = await api().open_in_ide(p)
            if (result?.error) onNotify(result.error, true)
          }}
          onNotify={onNotify}
          onRefresh={loadAll}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadges status={status} />
        <div className="flex flex-wrap items-center gap-2">
          <IdeButton
            ides={ides}
            defaultIde={ide}
            launching={launching}
            onLaunch={async (chosen) => {
              setLaunching(true)
              try {
                const result = await api().open_in_ide(repo.path, chosen)
                if (result?.ide_restart_required) {
                  // The IDE can't accept another project in this state; the
                  // only fix is a restart, so offer it rather than failing.
                  setLaunching(false)
                  if (window.confirm(`${result.error}\n\nRedémarrer ${result.ide_restart_required} maintenant sur ce projet ?`)) {
                    setLaunching(true)
                    const restart = await api().restart_ide(repo.path, chosen)
                    onNotify(restart?.error || restart?.log || 'IDE redémarré', !!restart?.error)
                    setTimeout(() => setLaunching(false), 3000)
                  }
                  return
                }
                if (result?.error) onNotify(`Ouverture IDE : ${result.error}`, true)
                else {
                  onNotify(result?.log || 'IDE ouvert')
                  setIde(chosen)
                }
                setTimeout(() => setLaunching(false), 3000)
              } catch (e) {
                // A rejected bridge call (rather than a resolved {error})
                // used to leave the button spinning forever with no way out.
                onNotify(`Ouverture IDE : ${e?.message || e}`, true)
                setLaunching(false)
              }
            }}
          />
          <TerminalButton path={repo.path} terminals={terminals} onNotify={onNotify} />
          <Button
            variant="ghost"
            disabled={busy || !status?.behind}
            title={!status?.behind ? 'Rien à récupérer — déjà à jour avec le remote' : undefined}
            onClick={() => run(() => api().pull(repo.path), 'Pull')}
          >
            <IconArrowDown className="h-3.5 w-3.5" />
            Pull
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !status?.ahead}
            title={!status?.ahead ? 'Rien à envoyer — aucun commit local en avance' : undefined}
            onClick={() => run(() => api().push(repo.path), 'Push')}
          >
            <IconArrowUp className="h-3.5 w-3.5" />
            Push
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setCommitOpen((v) => !v)}>
            <IconGitCommit className="h-3.5 w-3.5" />
            Commit
          </Button>
        </div>
      </div>

      {commitOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-2 shadow-[var(--card-shadow)]">
          {status?.files?.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-base">
              {status.files.map((f) => (
                <div key={f.path} className="flex items-center gap-2 border-b border-border px-2 py-1 text-[11px] last:border-b-0">
                  <span
                    className={`w-5 shrink-0 text-center font-mono font-medium ${
                      f.status === '?' ? 'text-success' : f.status === 'U' ? 'text-danger' : 'text-warning'
                    }`}
                    title={f.status === '?' ? 'Nouveau fichier' : f.status === 'U' ? 'Conflit' : 'Modifié'}
                  >
                    {f.status === '?' ? 'A' : f.status === 'U' ? '!' : 'M'}
                  </span>
                  <span className="truncate font-mono text-muted">{f.path}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Message de commit"
              rows={message.includes('\n') ? 5 : 1}
              className="w-full resize-y rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <Select
                value={genLanguage}
                onChange={setGenLanguage}
                title="Langue du message généré"
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-base px-2 py-1.5 text-[11px] text-text outline-none focus:border-accent"
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'fr', label: 'FR' },
                  { value: 'en', label: 'EN' },
                  { value: 'es', label: 'ES' },
                  { value: 'de', label: 'DE' },
                  { value: 'pt', label: 'PT' },
                ]}
              />
              <Button variant="ghost" disabled={generating} onClick={generateCommitMessage}>
                <IconSparkle className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
                {generating ? 'Génération…' : "Générer avec l'IA"}
              </Button>
              <Button
                variant="primary"
                className="ml-auto"
                disabled={busy || !message.trim()}
                onClick={async () => {
                  await run(() => api().commit(repo.path, message), 'Commit')
                  setMessage('')
                  setCommitOpen(false)
                }}
              >
                Valider
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-border">
        {[
          { id: 'branches', label: 'Branches' },
          { id: 'history', label: 'Historique' },
          { id: 'env', label: 'Env' },
          { id: 'ignore', label: 'Ignorer' },
          { id: 'run', label: 'Exécution' },
          { id: 'database', label: 'BDD' },
          { id: 'ai', label: 'IA' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`cursor-pointer border-b-2 px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
              activeTab === tab.id
                ? 'border-accent text-text'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Every tab stays mounted and is only hidden via CSS — switching tabs
          used to unmount the inactive ones, wiping their internal state
          (e.g. which AI session was open, DB filters/insert row in progress). */}
      <div className={activeTab === 'branches' ? '' : 'hidden'}>
        {loadingBranches && <p className="text-xs text-muted">Chargement…</p>}
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-1.5">
          {branches.map((branch) => {
            const isCurrent = branch === status?.branch
            return (
              <div
                key={branch}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-xs ${
                  isCurrent ? 'bg-accent-bg text-accent' : 'text-muted hover:bg-surface-hover'
                }`}
              >
                <span className="truncate font-mono">{branch}</span>
                {!isCurrent && (
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      disabled={busy}
                      title={`Fusionner ${branch} dans ${status?.branch || 'la branche actuelle'}`}
                      onClick={() => run(() => api().merge_branch(repo.path, branch), `Merge ${branch} → ${status?.branch}`)}
                      className="rounded border border-border px-2 py-0.5 text-[11px] text-text hover:border-border-strong hover:bg-surface-hover disabled:opacity-50 cursor-pointer"
                    >
                      Fusionner ici
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => run(() => api().switch_branch(repo.path, branch), `Switch → ${branch}`)}
                      className="rounded border border-border px-2 py-0.5 text-[11px] text-text hover:border-border-strong hover:bg-surface-hover disabled:opacity-50 cursor-pointer"
                    >
                      Switch
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {visitedTabs.has('history') && (
        <div className={activeTab === 'history' ? '' : 'hidden'}>
          <HistoryPanel repo={repo} />
        </div>
      )}

      <div className={activeTab === 'env' ? '' : 'hidden'}>
        <EnvPanel repo={repo} onNotify={onNotify} />
      </div>

      <div className={activeTab === 'ignore' ? '' : 'hidden'}>
        <IgnorePanel repo={repo} status={status} onNotify={onNotify} onRefresh={loadAll} />
      </div>

      <div className={activeTab === 'run' ? '' : 'hidden'}>
        <RunPanel
          repo={repo}
          runningConfigs={runningConfigs}
          onStart={onStartRun}
          onStop={onStopRun}
          onClear={onClearRun}
          onNotify={onNotify}
        />
      </div>

      {visitedTabs.has('database') && (
        <div className={activeTab === 'database' ? '' : 'hidden'}>
          <DatabasePanel repo={repo} onNotify={onNotify} />
        </div>
      )}
      {visitedTabs.has('ai') && (
        <div className={activeTab === 'ai' ? '' : 'hidden'}>
          <AiSessionsPanel repo={repo} onNotify={onNotify} />
        </div>
      )}
    </div>
  )
}

function NewGroupForm({ onCreate }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <IconPlus className="h-3.5 w-3.5" />
        Nouveau groupe
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            onCreate(name.trim())
            setName('')
            setOpen(false)
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Nom du groupe"
        className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
      />
      <Button
        variant="primary"
        disabled={!name.trim()}
        onClick={() => {
          onCreate(name.trim())
          setName('')
          setOpen(false)
        }}
      >
        Créer
      </Button>
      <button
        onClick={() => {
          setName('')
          setOpen(false)
        }}
        className="text-muted hover:text-text cursor-pointer"
        title="Annuler"
      >
        <IconClose className="h-4 w-4" />
      </button>
    </div>
  )
}

// Small area+line chart, no chart library — keeps the bundle light and
// matches the app's existing hand-rolled SVG icons/illustrations. Values
// are plotted against a fixed 0..max scale rather than an auto-fit one, so
// the line's height stays meaningful poll-to-poll instead of rescaling
// (and looking falsely dramatic) every time the peak changes slightly.
function Sparkline({ data, max, color }) {
  const width = 200
  const height = 44
  const safeMax = Math.max(max, 1)
  const padded = data.length > 1 ? data : [...data, ...data]
  const points = padded.map((v, i) => {
    const x = (i / (padded.length - 1)) * width
    const y = height - (Math.min(v, safeMax) / safeMax) * height
    return [x, y]
  })
  const linePath = `M ${points.map((p) => p.join(',')).join(' L ')}`
  const areaPath = `M 0,${height} L ${points.map((p) => p.join(',')).join(' L ')} L ${width},${height} Z`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-11 w-full" preserveAspectRatio="none">
      <path d={areaPath} fill={color} opacity="0.14" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const STATS_HISTORY_LEN = 40

function StatCard({ stat, history }) {
  const cpuHistory = history?.cpu || [stat.cpu_percent]
  const memHistory = history?.mem || [stat.memory_mb]
  const memMax = Math.max(256, ...memHistory)

  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-[var(--card-shadow)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{stat.name}</p>
          <p className="truncate font-mono text-[11px] text-muted">{stat.config}</p>
        </div>
        <span className="shrink-0 rounded-full bg-accent-bg px-2 py-0.5 text-[10px] text-accent">
          {stat.process_count} proc.
        </span>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
            <span>CPU</span>
            <span className="font-mono text-text">{stat.cpu_percent.toFixed(1)}%</span>
          </div>
          <Sparkline data={cpuHistory} max={100} color="var(--color-accent)" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
            <span>RAM</span>
            <span className="font-mono text-text">
              {stat.memory_mb >= 1024 ? `${(stat.memory_mb / 1024).toFixed(2)} Go` : `${stat.memory_mb.toFixed(0)} Mo`}
            </span>
          </div>
          <Sparkline data={memHistory} max={memMax} color="var(--color-success)" />
        </div>
      </div>
    </div>
  )
}

const UNGROUPED_KEY = '__ungrouped__'

function StatsPanel({ repos, groups, groupByPath }) {
  const [stats, setStats] = useState([])
  const historyRef = useRef({})
  const [, forceTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      const result = await api()?.get_process_stats()
      if (cancelled) return
      const list = Array.isArray(result) ? result : []
      setStats(list)

      const seenKeys = new Set()
      for (const s of list) {
        const key = `${s.path}-${s.config}`
        seenKeys.add(key)
        const entry = historyRef.current[key] || { cpu: [], mem: [] }
        entry.cpu = [...entry.cpu, s.cpu_percent].slice(-STATS_HISTORY_LEN)
        entry.mem = [...entry.mem, s.memory_mb].slice(-STATS_HISTORY_LEN)
        historyRef.current[key] = entry
      }
      // Drop history for runs that stopped, so restarting the same config
      // later starts a fresh trend instead of a stale one.
      for (const key of Object.keys(historyRef.current)) {
        if (!seenKeys.has(key)) delete historyRef.current[key]
      }
      forceTick((t) => t + 1)
    }
    poll()
    // Only runs while this tab is actually mounted (visited), so idle CPU
    // sampling doesn't happen in the background when nobody's looking.
    const interval = setInterval(poll, 1500)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (stats.length === 0) {
    return <EmptyState message="Aucun process en cours — lance un projet pour voir ses stats CPU/RAM ici." />
  }

  const enriched = stats.map((s) => ({
    ...s,
    name: repos.find((r) => r.path === s.path)?.name || s.path.split(/[\\/]/).pop(),
    group: groupByPath[s.path] || UNGROUPED_KEY,
  }))

  const byGroup = {}
  for (const s of enriched) {
    ;(byGroup[s.group] ||= []).push(s)
  }
  const orderedGroupKeys = [...groups.map((g) => g.name), UNGROUPED_KEY].filter((k) => byGroup[k])

  return (
    <div className="flex flex-col gap-6">
      {orderedGroupKeys.map((key) => (
        <div key={key}>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted">
            {key === UNGROUPED_KEY ? (
              'Sans groupe'
            ) : (
              <>
                <IconLayers className="h-3 w-3" />
                {key}
              </>
            )}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {byGroup[key].map((s) => {
              const statKey = `${s.path}-${s.config}`
              return <StatCard key={statKey} stat={s} history={historyRef.current[statKey]} />
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function GroupCard({ group, onOpen, onDelete, onRename }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(group.name)

  function commit() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== group.name) onRename(group.name, trimmed)
    else setName(group.name)
    setEditing(false)
  }

  return (
    <div
      onClick={() => !editing && onOpen(group.name)}
      className="group flex cursor-pointer items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 shadow-[var(--card-shadow)] transition-all duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-hover hover:shadow-[var(--card-shadow-hover)]"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-bg text-accent">
          <IconLayers className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          {editing ? (
            <input
              autoFocus
              value={name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') {
                  setName(group.name)
                  setEditing(false)
                }
              }}
              className="rounded-md border border-accent bg-base px-1.5 py-0.5 text-sm text-text outline-none"
            />
          ) : (
            <p className="truncate text-sm font-medium text-text">{group.name}</p>
          )}
          <p className="text-[11px] text-muted">
            {group.count} projet{group.count > 1 ? 's' : ''}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          className="text-muted hover:text-text cursor-pointer"
          title="Renommer"
        >
          <IconPencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(group.name)
          }}
          className="text-muted hover:text-danger cursor-pointer"
          title="Supprimer le groupe"
        >
          <IconTrash className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function LogPanel({ logs, onClose }) {
  return (
    <div className="fixed right-0 top-0 z-20 flex h-full w-80 flex-col border-l border-border bg-surface shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <IconTerminal className="h-4 w-4 text-muted" />
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted">Journaux</h2>
        </div>
        <button onClick={onClose} className="text-muted hover:text-text cursor-pointer">
          <IconClose className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {logs.length === 0 && <p className="text-xs text-muted">Aucune action pour l'instant.</p>}
        <div className="flex flex-col gap-2">
          {logs.map((entry) => (
            <div key={entry.id} className="rounded-md border border-border bg-base p-2">
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-medium ${entry.isError ? 'text-danger' : 'text-success'}`}>
                  {entry.isError ? 'Erreur' : 'OK'}
                </span>
                <span className="font-mono text-[10px] text-muted">{entry.time}</span>
              </div>
              <p className="mt-1 text-[12px] text-text">{entry.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function OrphanScanner({ onNotify }) {
  const [open, setOpen] = useState(false)
  const [orphans, setOrphans] = useState(null)
  const [scanning, setScanning] = useState(false)

  async function scan() {
    setScanning(true)
    const list = await api().find_orphan_processes()
    setOrphans(Array.isArray(list) ? list : [])
    setScanning(false)
  }

  async function kill(pid) {
    const result = await api().kill_orphan(pid)
    if (result?.error) onNotify(result.error, true)
    else onNotify(`Process ${pid} tué`)
    scan()
  }

  async function killAll() {
    await api().kill_orphans(orphans.map((o) => o.pid))
    onNotify(`${orphans.length} process tué(s)`)
    scan()
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) scan()
        }}
      >
        <IconTrash className="h-3.5 w-3.5" />
        Orphelins
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-96 rounded-md border border-border-strong bg-surface p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-text">Process orphelins détectés</span>
            <div className="flex items-center gap-2">
              {!scanning && orphans && orphans.length > 0 && (
                <button onClick={killAll} className="text-[11px] font-medium text-danger hover:opacity-70 cursor-pointer">
                  Tuer tous
                </button>
              )}
              <button onClick={scan} className="text-muted hover:text-text cursor-pointer" title="Rescanner">
                <IconRefresh className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {scanning && <p className="text-xs text-muted">Scan…</p>}
          {!scanning && orphans?.length === 0 && <p className="text-xs text-muted">Aucun orphelin trouvé.</p>}
          {!scanning && orphans && orphans.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {orphans.map((o) => (
                <div key={o.pid} className="flex items-center justify-between rounded-md bg-base px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-text">{o.repo_name}</p>
                    <p className="truncate font-mono text-[10px] text-muted">
                      PID {o.pid} · {o.name}
                    </p>
                  </div>
                  <Button variant="danger" onClick={() => kill(o.pid)}>
                    Tuer
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ProcessesPanel({
  tabs,
  activeTab,
  onSelectTab,
  runningPaths,
  onStop,
  onStopAll,
  onClose,
  onNotify,
  urls,
  onUrlChange,
  onReorderTabs,
  themeMode,
  onThemeChange,
}) {
  const active = tabs.find((t) => t.path === activeTab) || tabs[0]
  const url = (active && urls[active.path]) || ''
  const tabsScroll = useAutoHideScroll()
  // Dev servers print "Local: http://localhost:X" then "Network: http://
  // 192.168.x.x:X" right after, often in the same or next PTY chunk — the
  // `url` prop hasn't round-tripped through the parent yet when the second
  // one arrives, so a plain "if (!url)" guard reads a stale empty value
  // for both and the LAN one can win the race. This ref is updated
  // synchronously instead, and only ever upgrades loopback over LAN.
  const detectedUrlRef = useRef({})

  // Proxy mode is per-tab: one preview may need the header-stripping proxy
  // while another points at a local dev server that frames fine on its own.
  // undefined = auto, true/false = user overrode it for this tab.
  const [proxyByTab, setProxyByTab] = useState({})
  const proxyOverride = active ? proxyByTab[active.path] : undefined
  // Local dev servers frame fine on their own, and proxying them would move
  // the page to a different origin — breaking their cookies, CORS and the
  // HMR websocket. External sites are the ones that refuse framing.
  const proxied = proxyOverride ?? (!!url && !isLocalUrl(url))
  const [frameSrc, setFrameSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!url) {
      setFrameSrc('')
      return
    }
    if (!proxied) {
      setFrameSrc(url)
      return
    }
    api()
      ?.proxy_url(url)
      ?.then((r) => {
        if (cancelled) return
        if (r?.error) {
          onNotify(r.error, true)
          setFrameSrc(url)
        } else {
          setFrameSrc(r.url)
        }
      })
    return () => {
      cancelled = true
    }
  }, [url, proxied])

  function toggleProxy(path) {
    setProxyByTab((prev) => ({ ...prev, [path]: !proxied }))
  }

  // Layout state (split %, fullscreen pane, iframe reload) is per-tab —
  // each Processus tab keeps its own independent view instead of one
  // switching layout leaking onto the others.
  const [reloadKeyByTab, setReloadKeyByTab] = useState({})
  const [splitPctByTab, setSplitPctByTab] = useState({})
  const [focusedPaneByTab, setFocusedPaneByTab] = useState({})
  const reloadKey = (active && reloadKeyByTab[active.path]) || 0
  const splitPct = (active && splitPctByTab[active.path]) ?? 50
  const focusedPane = (active && focusedPaneByTab[active.path]) || null
  function setReloadKey(updater) {
    if (!active) return
    setReloadKeyByTab((prev) => ({
      ...prev,
      [active.path]: typeof updater === 'function' ? updater(prev[active.path] || 0) : updater,
    }))
  }
  function setSplitPct(value) {
    if (!active) return
    setSplitPctByTab((prev) => ({ ...prev, [active.path]: value }))
  }
  function setFocusedPane(value) {
    if (!active) return
    setFocusedPaneByTab((prev) => ({
      ...prev,
      [active.path]: typeof value === 'function' ? value(prev[active.path] || null) : value,
    }))
  }

  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef(null)
  const draggingRef = useRef(false)
  const [dragTabPath, setDragTabPath] = useState(null)

  const isRunning = active ? runningPaths.has(active.path) : false
  const showNav = focusedPane !== 'logs'
  const showLogs = focusedPane !== 'nav'

  useEffect(() => {
    function onMove(e) {
      if (!draggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setSplitPct(Math.min(85, Math.max(15, pct)))
    }
    function onUp() {
      draggingRef.current = false
      setIsDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (tabs.length === 0) {
    return (
      <div className="fixed inset-0 z-30 flex flex-col bg-base">
        <TitleBar />
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Processus</h2>
          <div className="flex items-center gap-2">
            <OrphanScanner onNotify={onNotify} />
            <ThemePicker mode={themeMode} onChange={onThemeChange} />
            <button onClick={onClose} className="text-muted hover:text-text cursor-pointer">
              <IconClose className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState message="Aucun process lancé pour l'instant." className="w-full max-w-sm" />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-base">
      <TitleBar />
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div ref={tabsScroll.ref} onScroll={tabsScroll.onScroll} className="theme-scroll flex items-center gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <div
                key={t.path}
                draggable
                onDragStart={() => setDragTabPath(t.path)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!dragTabPath || dragTabPath === t.path) return
                  const order = tabs.map((x) => x.path)
                  const from = order.indexOf(dragTabPath)
                  const to = order.indexOf(t.path)
                  order.splice(from, 1)
                  order.splice(to, 0, dragTabPath)
                  onReorderTabs(order)
                  setDragTabPath(null)
                }}
                onDragEnd={() => setDragTabPath(null)}
                onClick={() => onSelectTab(t.path)}
                className={`flex shrink-0 cursor-grab items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] transition-colors duration-150 active:cursor-grabbing ${
                  dragTabPath === t.path ? 'opacity-40' : ''
                } ${
                  active?.path === t.path ? 'bg-accent-bg text-accent' : 'text-muted hover:bg-surface-hover hover:text-text'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {t.repoName}
                <span className="font-mono text-[10px] text-muted">{t.configName}</span>
              </div>
            ))}
          </div>
          <div className="ml-2 flex shrink-0 items-center gap-2">
            <Button variant="ghost" disabled={runningPaths.size === 0} onClick={onStopAll}>
              <IconClose className="h-3.5 w-3.5" />
              Tout arrêter ({runningPaths.size})
            </Button>
            <OrphanScanner onNotify={onNotify} />
            <ThemePicker mode={themeMode} onChange={onThemeChange} />
            <button onClick={onClose} className="text-muted hover:text-text cursor-pointer">
              <IconClose className="h-4 w-4" />
            </button>
          </div>
        </div>

        {active && (
          <div
            ref={containerRef}
            className="flex flex-1 overflow-hidden"
            style={isDragging ? { userSelect: 'none', cursor: 'col-resize' } : undefined}
          >
            {showNav && (
              <div
                className="flex flex-col border-r border-border"
                style={{ width: showLogs ? `${splitPct}%` : '100%' }}
              >
                <div className="flex items-center gap-2 border-b border-border p-2">
                  <input
                    value={url}
                    onChange={(e) => onUrlChange(active.path, e.target.value)}
                    placeholder="http://localhost:3000"
                    className="flex-1 rounded-md border border-border bg-base px-2 py-1 font-mono text-[12px] text-text outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => setReloadKey((k) => k + 1)}
                    className="text-muted hover:text-text cursor-pointer"
                    title="Actualiser"
                  >
                    <IconRefresh className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      const result = await api().open_external(url)
                      if (!result?.ok) onNotify(`Échec de l'ouverture : ${result?.error}`, true)
                    }}
                    disabled={!url}
                    className="text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
                    title="Ouvrir dans le navigateur (utile si la page refuse l'iframe, ex: login)"
                  >
                    <IconExternal className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => toggleProxy(active.path)}
                    disabled={!url}
                    className={`cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 ${
                      proxied ? 'text-accent' : 'text-muted hover:text-text'
                    }`}
                    title={
                      proxied
                        ? `Proxy actif${proxyOverride === undefined ? ' (auto : site externe)' : ''} — retire X-Frame-Options. Cliquer pour charger en direct.`
                        : `Chargement direct${proxyOverride === undefined ? ' (auto : URL locale)' : ''} — cliquer pour passer par le proxy.`
                    }
                  >
                    <IconShield className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setFocusedPane(focusedPane === 'nav' ? null : 'nav')}
                    className="text-muted hover:text-text cursor-pointer"
                    title={focusedPane === 'nav' ? 'Rétablir le split' : 'Nav seul'}
                  >
                    <IconMaximize className="h-3.5 w-3.5" />
                  </button>
                </div>
                {url ? (
                  <iframe
                    key={`${frameSrc}-${reloadKey}`}
                    src={frameSrc}
                    title="preview"
                    className="flex-1 bg-white"
                    style={{ pointerEvents: isDragging ? 'none' : 'auto' }}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6">
                    <EmptyState message="Pas d'URL détectée dans les logs — colle-la manuellement ci-dessus." className="w-full max-w-sm" />
                  </div>
                )}
              </div>
            )}

            {showNav && showLogs && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault()
                  draggingRef.current = true
                  setIsDragging(true)
                }}
                className="relative w-1 shrink-0 cursor-col-resize bg-border hover:bg-accent active:bg-accent"
              >
                <div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize" />
              </div>
            )}

            {showLogs && (
              <div className="flex min-h-0 flex-col" style={{ width: showNav ? `${100 - splitPct}%` : '100%' }}>
                <div className="flex items-center justify-between border-b border-border p-2">
                  <span className="truncate font-mono text-[11px] text-muted">{active.realPath}</span>
                  <div className="flex items-center gap-2">
                    {isRunning ? (
                      <Button variant="danger" onClick={() => onStop(active.realPath, active.configName)}>
                        <IconClose className="h-3.5 w-3.5" />
                        Stop
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted">arrêté</span>
                    )}
                    <button
                      onClick={() => setFocusedPane(focusedPane === 'logs' ? null : 'logs')}
                      className="text-muted hover:text-text cursor-pointer"
                      title={focusedPane === 'logs' ? 'Rétablir le split' : 'Logs seuls'}
                    >
                      <IconMaximize className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {active.terminalId ? (
                  <PtyTerminal
                    key={active.terminalId}
                    terminalId={active.terminalId}
                    onNotify={onNotify}
                    onUrlDetected={(found) => {
                      const key = active.path
                      const current = detectedUrlRef.current[key] ?? url
                      if (!current || (!isLocalUrl(current) && isLocalUrl(found))) {
                        detectedUrlRef.current[key] = found
                        onUrlChange(key, found)
                      }
                    }}
                    className="flex-1 overflow-hidden bg-base p-2"
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center text-xs text-muted">Process terminé.</div>
                )}
              </div>
            )}
          </div>
        )}
    </div>
  )
}

const AI_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', kind: 'api', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'api', defaultBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'api', defaultBaseUrl: '', defaultModel: 'claude-sonnet-4-5' },
  { id: 'custom', label: 'Autre API (URL perso)', kind: 'api', defaultBaseUrl: '', defaultModel: '' },
  {
    id: 'claude-code',
    label: 'Claude Code (CLI)',
    kind: 'cli',
    // Skips project context (CLAUDE.md, MCP servers, tool scaffolding) that
    // a one-shot text generation doesn't need — plain "claude -p" boots a
    // full session and took 30s+ instead of a couple seconds for the same
    // prompt. Keeps OAuth/subscription auth (unlike --bare).
    defaultCliCommand: 'claude -p --setting-sources user --strict-mcp-config --tools "" --no-session-persistence',
  },
  { id: 'codex', label: 'Codex (CLI)', kind: 'cli', defaultCliCommand: 'codex exec' },
  { id: 'cli', label: 'Autre CLI', kind: 'cli', defaultCliCommand: '' },
]

const SHORTCUTS = [
  { keys: 'Ctrl K', label: 'Recherche globale (fichiers, branches, tous projets)' },
  { keys: 'Ctrl H', label: 'Cette aide' },
  { keys: 'F11', label: 'Plein écran (pratique dans Processus)' },
  { keys: 'Échap', label: 'Fermer la fenêtre active' },
]

function ShortcutsModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-xl border border-border-strong bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Raccourcis clavier</h2>
          <button onClick={onClose} className="text-muted hover:text-text cursor-pointer">
            <IconClose className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted">{s.label}</span>
              <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-text">{s.keys}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function GlobalSearchModal({ onClose, onOpenRepo, onOpenFile }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      return
    }
    setSearching(true)
    // Debounced: a fresh git ls-files + git branch per repo on every
    // keystroke would spawn a pile of processes for no benefit — only the
    // last pause in typing actually triggers a search.
    const timer = setTimeout(async () => {
      const result = await api().global_search(q)
      setResults(result?.results || [])
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/60 p-6 pt-24" onClick={onClose}>
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col rounded-xl border border-border-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-3">
          <IconSearch className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder="Nom de fichier ou de branche, dans tous les projets…"
            className="flex-1 bg-transparent text-sm text-text outline-none"
          />
          <button onClick={onClose} className="text-muted hover:text-text cursor-pointer">
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {!query.trim() ? (
            <p className="p-3 text-xs text-muted">Tape pour chercher dans tous tes projets à la fois.</p>
          ) : searching ? (
            <p className="p-3 text-xs text-muted">Recherche…</p>
          ) : results?.length === 0 ? (
            <p className="p-3 text-xs text-muted">Rien ne correspond à "{query}".</p>
          ) : (
            results?.map((r) => (
              <div key={r.path} className="mb-2 rounded-lg border border-border bg-base p-2">
                <button
                  onClick={() => onOpenRepo(r.path)}
                  className="mb-1 flex items-center gap-1.5 text-xs font-medium text-accent hover:underline cursor-pointer"
                >
                  <IconFolder className="h-3.5 w-3.5" />
                  {r.name}
                </button>
                {r.branches.length > 0 && (
                  <div className="mb-1 flex flex-wrap gap-1">
                    {r.branches.map((b) => (
                      <span key={b} className="rounded bg-accent-bg px-1.5 py-0.5 font-mono text-[10px] text-accent">
                        <IconBranch className="mr-1 inline h-2.5 w-2.5" />
                        {b}
                      </span>
                    ))}
                  </div>
                )}
                {r.files.map((f) => (
                  <button
                    key={f}
                    onClick={() => onOpenFile(r.path, f)}
                    title={`Ouvrir ${f} dans l'IDE`}
                    className="block w-full truncate rounded px-1 py-0.5 text-left font-mono text-[11px] text-muted hover:bg-surface-hover hover:text-text cursor-pointer"
                  >
                    {f}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function AiSettingsModal({ onClose, onNotify }) {
  const [provider, setProvider] = useState('openai')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [cliCommand, setCliCommand] = useState('')
  const [commitLanguage, setCommitLanguage] = useState('auto')
  const [hasKey, setHasKey] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [cliTools, setCliTools] = useState({ claude: true, codex: true })
  const [testingCli, setTestingCli] = useState(false)
  const [cliTestResult, setCliTestResult] = useState(null)
  const [configPath, setConfigPath] = useState('')

  useEffect(() => {
    api()
      ?.list_cli_tools()
      ?.then((t) => t && setCliTools(t))
  }, [])

  useEffect(() => {
    api()
      ?.get_config_path()
      ?.then((r) => r?.path && setConfigPath(r.path))
  }, [])

  useEffect(() => {
    api()
      ?.get_ai_settings()
      ?.then((s) => {
        if (s) {
          setProvider(s.provider || 'openai')
          setBaseUrl(s.base_url || '')
          setModel(s.model || '')
          setCliCommand(s.cli_command || '')
          setCommitLanguage(s.commit_language || 'auto')
          setHasKey(!!s.has_key)
        }
        setLoaded(true)
      })
  }, [])

  const currentPreset = AI_PROVIDERS.find((p) => p.id === provider)
  const isCli = currentPreset?.kind === 'cli'

  function selectProvider(id) {
    if (id === provider) return
    setProvider(id)
    setCliTestResult(null)
    const preset = AI_PROVIDERS.find((p) => p.id === id)
    if (preset) {
      setBaseUrl(preset.defaultBaseUrl || '')
      setModel(preset.defaultModel || '')
      setCliCommand(preset.defaultCliCommand || '')
    }
  }

  async function save() {
    const result = await api().save_ai_settings(provider, apiKey, baseUrl, model, cliCommand, commitLanguage)
    if (result?.error) onNotify(result.error, true)
    else {
      onNotify('Paramètres IA enregistrés')
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-border-strong bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Paramètres IA</h2>
          <button onClick={onClose} className="text-muted hover:text-text cursor-pointer">
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        {configPath && (
          <button
            onClick={async () => {
              const r = await copyText(configPath)
              onNotify(r.ok ? 'Chemin copié' : `Copie impossible : ${r.reason}`, !r.ok)
            }}
            title="Copier le chemin"
            className="mb-4 flex w-full items-center gap-2 truncate rounded-md border border-border bg-base px-2.5 py-1.5 text-left text-[11px] text-muted hover:text-text cursor-pointer"
          >
            <IconCopy className="h-3 w-3 shrink-0" />
            <span className="truncate">{configPath}</span>
          </button>
        )}

        {!loaded ? (
          <p className="text-xs text-muted">Chargement…</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">Provider</label>
              <div className="flex flex-wrap gap-1.5">
                {AI_PROVIDERS.filter((p) => {
                  // Only offer CLI providers actually installed on this machine —
                  // but never hide the one already configured, even if it went missing.
                  if (p.id === 'claude-code') return cliTools.claude || provider === 'claude-code'
                  if (p.id === 'codex') return cliTools.codex || provider === 'codex'
                  return true
                }).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectProvider(p.id)}
                    className={`cursor-pointer rounded-md border px-2.5 py-1 text-[12px] transition-colors duration-150 ${
                      provider === p.id
                        ? 'border-accent bg-accent-bg text-accent'
                        : 'border-border text-muted hover:text-text hover:border-border-strong'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {isCli ? (
              <>
                <p className="rounded-md bg-accent-bg px-3 py-2 text-[11px] text-accent">
                  Pas de clé API — Dev Hub appelle le CLI déjà installé sur ta machine, avec ton abonnement existant.
                </p>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">Commande CLI</label>
                  <input
                    value={cliCommand}
                    onChange={(e) => setCliCommand(e.target.value)}
                    placeholder="claude -p"
                    className="w-full rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
                  />
                  <p className="mt-1 text-[11px] text-muted">
                    Le prompt est ajouté automatiquement comme dernier argument.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    disabled={testingCli || !cliCommand.trim()}
                    onClick={async () => {
                      setTestingCli(true)
                      setCliTestResult(null)
                      const result = await api().test_cli_auth(cliCommand)
                      setCliTestResult(result)
                      setTestingCli(false)
                    }}
                  >
                    <IconCheck className={`h-3.5 w-3.5 ${testingCli ? 'animate-spin' : ''}`} />
                    {testingCli ? 'Test…' : 'Tester la connexion'}
                  </Button>
                  {cliTestResult && (
                    <span className={`flex items-center gap-1 text-[11px] ${cliTestResult.ok ? 'text-success' : 'text-danger'}`}>
                      {cliTestResult.ok ? <IconCheck className="h-3 w-3" /> : <IconAlertCircle className="h-3 w-3" />}
                      {cliTestResult.ok ? 'CLI opérationnel' : cliTestResult.error}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">Clé API</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={hasKey ? 'Déjà enregistrée — laisse vide pour garder' : 'sk-...'}
                    className="w-full rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
                  />
                </div>

                {provider !== 'anthropic' && (
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">Base URL</label>
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                      className="w-full rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">Modèle</label>
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="gpt-4o-mini"
                    className="w-full rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
                  />
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">Langue des messages de commit générés</label>
              <Select
                value={commitLanguage}
                onChange={setCommitLanguage}
                className="flex w-full cursor-pointer items-center justify-between gap-1 rounded-md border border-border bg-base px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
                options={[
                  { value: 'auto', label: 'Auto (laisse le modèle décider)' },
                  { value: 'fr', label: 'Français' },
                  { value: 'en', label: 'Anglais' },
                  { value: 'es', label: 'Espagnol' },
                  { value: 'de', label: 'Allemand' },
                  { value: 'pt', label: 'Portugais' },
                ]}
              />
            </div>

            <Button variant="primary" className="self-end" onClick={save}>
              Enregistrer
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

const THEMES = [
  { id: 'dark', label: 'Dev Hub Dark', bg: '#0a0a0c', swatch: ['#8b8b93', '#6e56cf', '#3ddc8c', '#f0616d'] },
  { id: 'light', label: 'Dev Hub Light', bg: '#ffffff', swatch: ['#63636c', '#6e56cf', '#157a3c', '#c8262c'] },
  { id: 'tokyo-night', label: 'Tokyo Night', bg: '#1a1b26', swatch: ['#565f89', '#7aa2f7', '#9ece6a', '#f7768e'] },
  { id: 'tokyo-day', label: 'Tokyo Day', bg: '#e1e2e7', swatch: ['#848cb5', '#2e7de9', '#587539', '#8c4351'] },
  { id: 'monokai', label: 'Monokai', bg: '#272822', swatch: ['#75715e', '#66d9ef', '#a6e22e', '#f92672'] },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', bg: '#1e1e2e', swatch: ['#a6adc8', '#cba6f7', '#a6e3a1', '#f38ba8'] },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', bg: '#eff1f5', swatch: ['#6c6f85', '#8839ef', '#40a02b', '#d20f39'] },
  { id: 'dracula', label: 'Dracula', bg: '#282a36', swatch: ['#6272a4', '#bd93f9', '#50fa7b', '#ff5555'] },
  { id: 'nord', label: 'Nord', bg: '#2e3440', swatch: ['#8b96ad', '#88c0d0', '#a3be8c', '#bf616a'] },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', bg: '#282828', swatch: ['#a89984', '#fe8019', '#b8bb26', '#fb4934'] },
  { id: 'atom-one-dark', label: 'Atom One Dark', bg: '#282c34', swatch: ['#5c6370', '#61afef', '#98c379', '#e06c75'] },
  { id: 'atom-one-light', label: 'Atom One Light', bg: '#fafafa', swatch: ['#a0a1a7', '#4078f2', '#50a14f', '#e45649'] },
  { id: 'halloween', label: 'Halloween', bg: '#1b1520', swatch: ['#8a7a99', '#ff7518', '#8fbc4a', '#e6304a'] },
  { id: 'diwali', label: 'Diwali', bg: '#1a0f1f', swatch: ['#a68a91', '#f2b705', '#4caf50', '#c1272d'] },
  { id: 'movember', label: 'Movember', bg: '#1c1712', swatch: ['#9c8b73', '#c17d3a', '#7a8b4a', '#a8442e'] },
  { id: 'dia-de-muertos', label: 'Dia De Muertos', bg: '#160f1a', swatch: ['#a48ba8', '#ff5f9e', '#3ec9a7', '#f8a531'] },
  { id: 'winter-day', label: 'Winter Day', bg: '#f7f9fc', swatch: ['#5b6b82', '#3a7bd5', '#2f9e6e', '#c07a1e'] },
]

function ThemeSwatch({ theme, className }) {
  return (
    <div
      style={{ background: theme.bg }}
      className={`flex shrink-0 flex-col justify-center gap-[3px] overflow-hidden rounded-md border border-black/10 p-1.5 ${className || 'h-10 w-16'}`}
    >
      <div className="h-[3px] w-3/5 rounded-full" style={{ background: theme.swatch[1] }} />
      <div className="h-[3px] w-4/5 rounded-full" style={{ background: theme.swatch[0] }} />
      <div className="h-[3px] w-2/5 rounded-full" style={{ background: theme.swatch[2] }} />
      <div className="h-[3px] w-1/2 rounded-full" style={{ background: theme.swatch[3] }} />
    </div>
  )
}

function ThemePicker({ mode, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const listScroll = useAutoHideScroll()
  const current = THEMES.find((t) => t.id === mode) || THEMES[0]

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <Button variant="subtle" onClick={() => setOpen((v) => !v)} title="Thème">
        <IconPalette className="h-3.5 w-3.5" />
        Thème
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1.5 w-96 overflow-hidden rounded-lg border border-border-strong bg-surface shadow-2xl">
          <p className="border-b border-border px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted">
            Thèmes
          </p>
          <div ref={listScroll.ref} onScroll={listScroll.onScroll} className="theme-scroll max-h-[calc(100vh-8rem)] overflow-y-auto p-1.5">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => onChange(t.id)}
                className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-[13px] transition-colors duration-150 cursor-pointer ${
                  mode === t.id ? 'bg-accent-bg text-accent' : 'text-text hover:bg-surface-hover'
                }`}
              >
                <ThemeSwatch theme={t} />
                <span className="truncate font-medium">{t.label}</span>
                {mode === t.id && <IconCheck className="ml-auto h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ZoomControl({ zoom, onChange }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      <button
        onClick={() => onChange(Math.max(50, zoom - 10))}
        className="flex h-6 w-6 items-center justify-center rounded text-sm text-muted hover:bg-surface-hover hover:text-text cursor-pointer"
        title="Dézoomer"
      >
        −
      </button>
      <button
        onClick={() => onChange(100)}
        className="min-w-[38px] rounded px-1 py-0.5 text-center text-[11px] text-muted hover:bg-surface-hover hover:text-text cursor-pointer"
        title="Réinitialiser le zoom"
      >
        {zoom}%
      </button>
      <button
        onClick={() => onChange(Math.min(150, zoom + 10))}
        className="flex h-6 w-6 items-center justify-center rounded text-sm text-muted hover:bg-surface-hover hover:text-text cursor-pointer"
        title="Zoomer"
      >
        +
      </button>
    </div>
  )
}

function ConfirmModal({ title, message, confirmLabel = 'Confirmer', onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-xl border border-border-strong bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-sm font-semibold text-text">{title}</h3>
        <p className="mb-4 text-xs text-muted">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
          <Button variant="solid-danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

function TitleBar() {
  return (
    <div className="pywebview-drag-region flex h-8 shrink-0 items-center justify-end bg-base" onDoubleClick={() => api()?.toggle_maximize_window()}>
      <button
        onClick={() => api()?.minimize_window()}
        className="flex h-8 w-11 cursor-pointer items-center justify-center text-muted hover:bg-surface-hover hover:text-text"
        title="Réduire"
      >
        <IconWinMinimize className="h-3 w-3" />
      </button>
      <button
        onClick={() => api()?.toggle_maximize_window()}
        className="flex h-8 w-11 cursor-pointer items-center justify-center text-muted hover:bg-surface-hover hover:text-text"
        title="Agrandir / Restaurer"
      >
        <IconWinMaximize className="h-3 w-3" />
      </button>
      <button
        onClick={() => api()?.close_window()}
        className="flex h-8 w-11 cursor-pointer items-center justify-center text-muted hover:bg-danger hover:text-white"
        title="Fermer"
      >
        <IconClose className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

const SPLASH_MIN_MS = 1400

function SplashScreen({ ready }) {
  const [visible, setVisible] = useState(true)
  const [fading, setFading] = useState(false)
  const mountedAt = useRef(Date.now())

  useEffect(() => {
    if (!ready) return
    // The bridge can be ready almost instantly on a warm start, which used
    // to cut the ripple animation off after barely a frame — showing the
    // splash for a fixed minimum stretch instead of vanishing the moment
    // the API answers actually lets the animation register as intentional.
    const elapsed = Date.now() - mountedAt.current
    const startFade = () => {
      setFading(true)
      setTimeout(() => setVisible(false), 500)
    }
    const timer = setTimeout(startFade, Math.max(0, SPLASH_MIN_MS - elapsed))
    return () => clearTimeout(timer)
  }, [ready])

  if (!visible) return null

  return (
    <div
      className={`fixed inset-0 z-[300] flex items-center justify-center bg-base transition-opacity duration-500 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="splash-ripple absolute h-full w-full rounded-full border-2 border-accent" style={{ animationDelay: '0s' }} />
        <span className="splash-ripple absolute h-full w-full rounded-full border-2 border-accent" style={{ animationDelay: '0.6s' }} />
        <span className="splash-ripple absolute h-full w-full rounded-full border-2 border-accent" style={{ animationDelay: '1.2s' }} />
        <span className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white shadow-lg">
          <IconLayers className="h-6 w-6" />
        </span>
      </div>
    </div>
  )
}

export default function App() {
  const [repos, setRepos] = useState([])
  const [groups, setGroups] = useState([])
  const [groupRepos, setGroupRepos] = useState([])
  const [ides, setIdes] = useState([])
  const [terminals, setTerminals] = useState(['cmd', 'powershell'])
  const [ready, setReady] = useState(false)
  const [toasts, setToasts] = useState([])
  const [logs, setLogs] = useState([])
  const [logsOpen, setLogsOpen] = useState(false)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'F11') {
        e.preventDefault()
        api()?.toggle_fullscreen()
        return
      }
      if (e.key === 'Escape') {
        if (globalSearchOpen || shortcutsOpen || aiSettingsOpen) {
          setGlobalSearchOpen(false)
          setShortcutsOpen(false)
          setAiSettingsOpen(false)
        }
        return
      }
      if (!e.ctrlKey) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setShortcutsOpen(false)
        setGlobalSearchOpen((v) => !v)
      } else if (key === 'h') {
        e.preventDefault()
        setGlobalSearchOpen(false)
        setShortcutsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [globalSearchOpen, shortcutsOpen, aiSettingsOpen])
  const [themeMode, setThemeMode] = useState(() => {
    try {
      return localStorage.getItem('devhub-theme') || 'dark'
    } catch {
      return 'dark'
    }
  })

  // localStorage still holds a copy so the first paint uses the right theme
  // instead of flashing the default, but config.json is the source of truth.
  const themeLoaded = useRef(false)

  useEffect(() => {
    api()
      ?.get_theme()
      ?.then((r) => {
        if (r?.theme) setThemeMode(r.theme)
        themeLoaded.current = true
      })
  }, [ready])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode)
    try {
      localStorage.setItem('devhub-theme', themeMode)
    } catch {
      // ignore storage errors
    }
    if (themeLoaded.current) api()?.set_theme(themeMode)
  }, [themeMode])

  const [zoom, setZoom] = useState(() => {
    try {
      return Number(localStorage.getItem('devhub-zoom')) || 100
    } catch {
      return 100
    }
  })

  useEffect(() => {
    document.documentElement.style.zoom = `${zoom}%`
    try {
      localStorage.setItem('devhub-zoom', String(zoom))
    } catch {
      // ignore storage errors
    }
  }, [zoom])

  const [selectedPath, setSelectedPath] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [listTab, setListTab] = useState('groups')
  const [groupSearch, setGroupSearch] = useState('')
  const [repoSearch, setRepoSearch] = useState('')
  const [repoGroupFilter, setRepoGroupFilter] = useState('all')
  const [runningPaths, setRunningPaths] = useState(() => new Set())
  const [runningMeta, setRunningMeta] = useState({})
  const [processesOpen, setProcessesOpen] = useState(false)
  const [launchingGroup, setLaunchingGroup] = useState(false)
  const [groupSelection, setGroupSelection] = useState(() => new Set())
  // Stays mounted (hidden via CSS) once opened once, so closing/reopening the
  // drawer doesn't wipe per-tab layout state (split %, fullscreen pane, etc).
  const [hasOpenedProcesses, setHasOpenedProcesses] = useState(false)
  const [orphanAlert, setOrphanAlert] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [activeProcessTab, setActiveProcessTab] = useState(null)
  const [processUrls, setProcessUrls] = useState({})
  const [tabOrder, setTabOrder] = useState([])

  function setProcessUrl(key, url) {
    setProcessUrls((prev) => ({ ...prev, [key]: url }))
  }

  // A project can now run several configs at once, so every run is tracked
  // by (path, config name) instead of just path — one project's two "npm
  // run dev" and "npm run worker" no longer clobber the same slot.
  function runKey(path, name) {
    return `${path}::${name}`
  }

  // Running processes are keyed "<path>::<config>", so a project is active
  // when any key starts with its path.
  function runningCountFor(path) {
    let n = 0
    for (const key of runningPaths) if (key.startsWith(`${path}::`)) n += 1
    return n
  }

  async function stopAllFor(paths) {
    const targets = []
    for (const key of runningPaths) {
      const meta = runningMeta[key]
      if (meta && (!paths || paths.includes(meta.realPath))) targets.push(meta)
    }
    if (targets.length === 0) {
      notify('Aucun processus en cours', true)
      return
    }
    for (const meta of targets) await api().stop_run(meta.realPath, meta.configName)
    notify(`${targets.length} processus arrêté(s)`)
  }

  useEffect(() => {
    setTabOrder((prev) => {
      const stillRunning = prev.filter((p) => runningPaths.has(p))
      const newOnes = [...runningPaths].filter((p) => !stillRunning.includes(p))
      return [...stillRunning, ...newOnes]
    })
  }, [runningPaths])

  const refresh = useCallback(async () => {
    // pywebview populates window.pywebview.api a moment after creating
    // window.pywebview, so a cold start can get here before it exists.
    // Without this wait the lists silently loaded as empty and never retried.
    for (let i = 0; i < 50 && !api(); i++) await new Promise((r) => setTimeout(r, 100))
    if (!api()) return

    // Re-scanned on every refresh (not just at startup) so an IDE installed
    // after Dev Hub was launched shows up without restarting the app.
    api()
      .list_ides()
      .then((list) => setIdes(Array.isArray(list) ? list : []))
      .catch(() => {})

    // The bridge can answer before it's fully wired and hand back nothing, so
    // an empty result on a cold start is retried rather than trusted. A truly
    // empty config just costs a few harmless extra calls.
    for (let attempt = 0; attempt < 5; attempt++) {
      let repoList = []
      let groupList = []
      try {
        ;[repoList, groupList] = await Promise.all([api().list_repos(), api().list_groups()])
      } catch {
        // bridge not answering yet — fall through to the retry delay
      }
      const repos = repoList || []
      const groups = groupList || []
      if (repos.length || groups.length || attempt === 4) {
        setRepos(repos)
        setGroups(groups)
        return
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }, [])

  const refreshGroupRepos = useCallback(async (name) => {
    const list = await api()?.group_repos(name)
    setGroupRepos(Array.isArray(list) ? list : [])
  }, [])

  useEffect(() => {
    function init() {
      setReady(true)
      refresh()
      api()
        ?.list_terminals()
        ?.then((list) => setTerminals(Array.isArray(list) ? list : ['cmd', 'powershell']))
      api()
        ?.find_orphan_processes()
        ?.then((list) => {
          if (Array.isArray(list) && list.length > 0) setOrphanAlert(list)
        })
    }
    // Don't depend on catching the pywebviewready event: with a warm WebView2
    // cache the bridge can be injected before React mounts, so the listener
    // is registered too late and never fires — which left the UI empty
    // forever. Poll for the bridge as well, and run init once, whichever
    // signal arrives first.
    let started = false
    let timer = null

    function startOnce() {
      if (started || !api()) return
      started = true
      clearInterval(timer)
      window.removeEventListener('pywebviewready', startOnce)
      init()
    }

    startOnce()
    if (!started) {
      window.addEventListener('pywebviewready', startOnce)
      timer = setInterval(startOnce, 100)
    }
    return () => {
      clearInterval(timer)
      window.removeEventListener('pywebviewready', startOnce)
    }
  }, [refresh])

  useEffect(() => {
    window.__devhub_onRunExit = (path, name, code) => {
      // Keep runningMeta/activeProcessTab as-is: the terminal (and its logs)
      // should stay visible after the process ends until the user explicitly
      // clears it — only the "running" flag flips off.
      setRunningPaths((prev) => {
        const next = new Set(prev)
        next.delete(runKey(path, name))
        return next
      })
      notify(`Process terminé (code ${code})`, code !== 0)
    }
    return () => {
      delete window.__devhub_onRunExit
    }
  }, [])

  useEffect(() => {
    if (selectedGroup) refreshGroupRepos(selectedGroup)
  }, [selectedGroup, refreshGroupRepos])

  function notify(text, isError = false) {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, text, isError }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
    setLogs((prev) => [
      { id: crypto.randomUUID(), text, isError, time: new Date().toLocaleTimeString() },
      ...prev,
    ].slice(0, 100))
  }

  async function addRepo() {
    const path = await api().pick_folder()
    if (!path) return
    const result = await api().add_repo(path)
    if (result?.error) notify(result.error, true)
    else notify(`Projet ajouté : ${result.name}`)
    refresh()
  }

  async function scanFolder() {
    const path = await api().pick_folder()
    if (!path) return
    const result = await api().scan_folder(path)
    if (result?.error) notify(result.error, true)
    else if (result.added === 0) notify('Aucun nouveau projet trouvé dans ce dossier')
    else notify(`${result.added} projet(s) ajouté(s)`)
    refresh()
  }

  async function doRemoveRepo(path) {
    await api().remove_repo(path)
    if (selectedPath === path) setSelectedPath(null)
    notify('Repo retiré')
    refresh()
    setConfirmDialog(null)
  }

  function removeRepo(path) {
    const repoName = repos.find((r) => r.path === path)?.name || path
    setConfirmDialog({
      title: 'Retirer ce projet ?',
      message: `"${repoName}" sera retiré de Dev Hub. Les fichiers ne seront pas supprimés du disque.`,
      confirmLabel: 'Retirer',
      onConfirm: () => doRemoveRepo(path),
    })
  }

  async function openIde(path, ide) {
    try {
      const result = await api().open_in_ide(path, ide)
      if (result?.error) notify(result.error, true)
      else notify(result?.log || 'IDE ouvert')
    } catch (e) {
      notify(`Ouverture IDE : ${e?.message || e}`, true)
    }
    refresh()
  }

  async function createGroup(name) {
    const result = await api().create_group(name)
    if (result?.error) notify(result.error, true)
    else notify(`Groupe "${name}" créé`)
    refresh()
  }

  async function doDeleteGroup(name) {
    await api().delete_group(name)
    if (selectedGroup === name) setSelectedGroup(null)
    notify(`Groupe "${name}" supprimé`)
    refresh()
    setConfirmDialog(null)
  }

  function deleteGroup(name) {
    setConfirmDialog({
      title: 'Supprimer ce groupe ?',
      message: `Le groupe "${name}" sera supprimé. Les repos qu'il contient restent dans Dev Hub, juste dégroupés.`,
      confirmLabel: 'Supprimer',
      onConfirm: () => doDeleteGroup(name),
    })
  }

  async function renameGroup(oldName, newName) {
    const result = await api().rename_group(oldName, newName)
    if (result?.error) notify(result.error, true)
    else {
      notify(`Groupe renommé en "${newName}"`)
      if (selectedGroup === oldName) setSelectedGroup(newName)
      refresh()
    }
  }

  async function addToGroup(name, path) {
    await api().add_repo_to_group(name, path)
    notify(`Ajouté à "${name}"`)
    refresh()
  }

  async function doRemoveFromGroup(path) {
    await api().remove_repo_from_group(selectedGroup, path)
    notify('Retiré du groupe')
    refreshGroupRepos(selectedGroup)
    refresh()
    setConfirmDialog(null)
  }

  function removeFromGroup(path) {
    const repoName = groupRepos.find((r) => r.path === path)?.name || path
    setConfirmDialog({
      title: 'Sortir ce projet du groupe ?',
      message: `"${repoName}" sera retiré de "${selectedGroup}". Il reste dans Dev Hub, juste hors du groupe.`,
      confirmLabel: 'Sortir du groupe',
      onConfirm: () => doRemoveFromGroup(path),
    })
  }

  async function startRun(path, name, repoName, url) {
    const key = runKey(path, name)
    const result = await api().start_run(path, name)
    if (result?.error) notify(result.error, true)
    else {
      setRunningPaths((prev) => new Set(prev).add(key))
      setRunningMeta((prev) => ({
        ...prev,
        [key]: { realPath: path, repoName: repoName || path, configName: name, terminalId: result.terminal_id },
      }))
      setActiveProcessTab(key)
      if (url) setProcessUrl(key, url)
      notify(`"${name}" lancé`)
    }
    return result
  }

  async function stopRun(path, name) {
    const result = await api().stop_run(path, name)
    if (result?.error) notify(result.error, true)
  }

  // A selection only makes sense for the group you're looking at.
  useEffect(() => {
    setGroupSelection(new Set())
  }, [selectedGroup])

  function toggleGroupSelection(path) {
    setGroupSelection((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function runGroup(groupName) {
    setLaunchingGroup(true)
    const group = groups.find((g) => g.name === groupName)
    // No explicit selection means "run the whole group".
    const all = group?.repos || []
    const paths = groupSelection.size > 0 ? all.filter((p) => groupSelection.has(p)) : all
    let started = 0
    const skipped = []

    for (const path of paths) {
      const repo = repos.find((r) => r.path === path)
      const configs = (await api().list_run_configs(path)) || []
      const cfg = configs.find((c) => c.default) || configs[0]
      if (!cfg) {
        skipped.push(repo?.name || path)
        continue
      }
      if (runningPaths.has(runKey(path, cfg.name))) continue
      const result = await startRun(path, cfg.name, repo?.name, cfg.url)
      if (!result?.error) started += 1
    }

    setLaunchingGroup(false)
    if (started > 0) setProcessesOpen(true)
    if (skipped.length) {
      notify(`${started} lancé(s) — sans commande : ${skipped.join(', ')}`, true)
    }
  }

  async function clearRunEntry(key) {
    const terminalId = runningMeta[key]?.terminalId
    if (terminalId) api().clear_run_buffer(terminalId)
    setRunningMeta((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setActiveProcessTab((prev) => (prev === key ? null : prev))
  }

  async function killAllOrphans() {
    const pids = orphanAlert.map((o) => o.pid)
    await api().kill_orphans(pids)
    notify(`${pids.length} process orphelin(s) tué(s)`)
    setOrphanAlert(null)
  }

  const selectedRepo = repos.find((r) => r.path === selectedPath) || null
  const showList = ready && !selectedRepo && !selectedGroup
  const filteredGroups = groups.filter((g) => g.name.toLowerCase().includes(groupSearch.trim().toLowerCase()))
  const groupByPath = {}
  groups.forEach((g) => (g.repos || []).forEach((p) => { groupByPath[p] = g.name }))
  const filteredRepos = repos.filter((r) => {
    const matchesSearch = `${r.name} ${r.path}`.toLowerCase().includes(repoSearch.trim().toLowerCase())
    if (!matchesSearch) return false
    if (repoGroupFilter === 'all') return true
    if (repoGroupFilter === 'ungrouped') return !groupByPath[r.path]
    return groupByPath[r.path] === repoGroupFilter
  })

  return (
    <div className="min-h-screen bg-base text-text">
      <TitleBar />
      <SplashScreen ready={ready} />
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white">
            <IconLayers className="h-4 w-4" />
          </span>
          <h1 className="text-[15px] font-semibold tracking-tight">Dev Hub</h1>
        </div>
        <div className="flex items-center gap-2">
          <ZoomControl zoom={zoom} onChange={setZoom} />
          <Button variant="subtle" onClick={() => setGlobalSearchOpen(true)}>
            <IconSearch className="h-3.5 w-3.5" />
            Rechercher
            <span className="ml-1 rounded border border-border px-1 font-mono text-[10px] text-muted">Ctrl K</span>
          </Button>
          <button
            onClick={() => setShortcutsOpen(true)}
            title="Raccourcis clavier (Ctrl H)"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted hover:text-text hover:border-border-strong cursor-pointer"
          >
            ?
          </button>
          <Button variant="subtle" onClick={() => setAiSettingsOpen(true)}>
            <IconSettings className="h-3.5 w-3.5" />
            Paramètres IA
          </Button>
          <Button
            variant="subtle"
            onClick={() => {
              setProcessesOpen(true)
              setHasOpenedProcesses(true)
            }}
          >
            <IconMonitor className="h-3.5 w-3.5" />
            Processus
            {runningPaths.size > 0 && (
              <span className="ml-1 rounded-full bg-success-bg px-1.5 py-0 text-[10px] text-success">
                {runningPaths.size}
              </span>
            )}
          </Button>
          <Button variant="subtle" onClick={() => setLogsOpen((v) => !v)}>
            <IconTerminal className="h-3.5 w-3.5" />
            Journaux
          </Button>
          {showList && (
            <>
              <Button variant="subtle" onClick={refresh} className="px-2" title="Rafraîchir">
                <IconRefresh className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" onClick={scanFolder} title="Scanner un dossier" className="px-2">
                <IconScan className="h-3.5 w-3.5" />
              </Button>
              <Button variant="primary" onClick={addRepo} title="Ajouter un projet" className="px-2">
                <IconPlus className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <ThemePicker mode={themeMode} onChange={setThemeMode} />
        </div>
      </header>

      {logsOpen && <LogPanel logs={logs} onClose={() => setLogsOpen(false)} />}
      {aiSettingsOpen && <AiSettingsModal onClose={() => setAiSettingsOpen(false)} onNotify={notify} />}
      {globalSearchOpen && (
        <GlobalSearchModal
          onClose={() => setGlobalSearchOpen(false)}
          onOpenRepo={(path) => {
            setSelectedPath(path)
            setGlobalSearchOpen(false)
          }}
          onOpenFile={(repoPath, file) => {
            const ide = repos.find((r) => r.path === repoPath)?.ide
            openIde(`${repoPath}/${file}`, ide)
            setGlobalSearchOpen(false)
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      {confirmDialog && (
        <ConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
      {hasOpenedProcesses && (
        <div className={processesOpen ? '' : 'hidden'}>
          <ProcessesPanel
            tabs={tabOrder
              .filter((key) => runningPaths.has(key) && runningMeta[key])
              .map((key) => ({ path: key, ...runningMeta[key] }))}
            activeTab={activeProcessTab}
            onSelectTab={setActiveProcessTab}
            runningPaths={runningPaths}
            onStop={stopRun}
            onStopAll={() => stopAllFor(null)}
            onClose={() => setProcessesOpen(false)}
            onNotify={notify}
            urls={processUrls}
            onUrlChange={setProcessUrl}
            onReorderTabs={setTabOrder}
            themeMode={themeMode}
            onThemeChange={setThemeMode}
          />
        </div>
      )}

      {orphanAlert && orphanAlert.length > 0 && (
        <div className="mx-6 mt-4 flex items-center justify-between rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">
          <span>
            {orphanAlert.length} process orphelin{orphanAlert.length > 1 ? 's' : ''} détecté
            {orphanAlert.length > 1 ? 's' : ''} (session précédente) — {orphanAlert.map((o) => o.repo_name).join(', ')}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="danger" onClick={killAllOrphans}>
              Tuer tous
            </Button>
            <button onClick={() => setOrphanAlert(null)} className="text-danger hover:opacity-70 cursor-pointer">
              <IconClose className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className={`flex w-80 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-xs shadow-lg backdrop-blur-sm ${
                t.isError
                  ? 'border-danger/30 bg-danger-bg text-danger'
                  : 'border-success/30 bg-success-bg text-success'
              }`}
            >
              {t.isError ? (
                <IconAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span className="min-w-0 break-words">{t.text}</span>
            </div>
          ))}
        </div>
      )}

      <main className="p-6">
        {showList && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-1 border-b border-border">
              {[
                { id: 'groups', label: 'Groupes' },
                { id: 'repos', label: 'Projets' },
                { id: 'stats', label: 'Stats' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setListTab(tab.id)}
                  className={`cursor-pointer border-b-2 px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
                    listTab === tab.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {listTab === 'groups' && (
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <input
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    placeholder="Rechercher un groupe…"
                    className="w-64 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
                  />
                  <NewGroupForm onCreate={createGroup} />
                </div>
                {groups.length === 0 ? (
                  <EmptyState message="Aucun groupe — regroupe des projets liés (ex: front + back d'un même projet)." />
                ) : filteredGroups.length === 0 ? (
                  <EmptyState message={`Aucun groupe ne correspond à "${groupSearch}".`} size="sm" />
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredGroups.map((g) => (
                      <GroupCard key={g.name} group={g} onOpen={setSelectedGroup} onDelete={deleteGroup} onRename={renameGroup} />
                    ))}
                  </div>
                )}
              </section>
            )}

            {listTab === 'repos' && (
              <section>
                <div className="mb-3 flex gap-2">
                  <input
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Rechercher un projet…"
                    className="w-64 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
                  />
                  <Select
                    value={repoGroupFilter}
                    onChange={setRepoGroupFilter}
                    className="flex w-48 shrink-0 cursor-pointer items-center justify-between rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
                    options={[
                      { value: 'all', label: 'Tous les groupes' },
                      { value: 'ungrouped', label: 'Sans groupe' },
                      ...groups.map((g) => ({ value: g.name, label: g.name })),
                    ]}
                  />
                </div>
                {repos.length === 0 ? (
                  <EmptyState message='Aucun projet pour l&apos;instant — clique sur "Ajouter un projet".' />
                ) : filteredRepos.length === 0 ? (
                  <EmptyState message={`Aucun projet ne correspond à "${repoSearch}".`} size="sm" />
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredRepos.map((repo) => (
                      <RepoCard
                        key={repo.path}
                        repo={repo}
                        groups={groups}
                        ides={ides}
                        onOpen={(r) => setSelectedPath(r.path)}
                        onOpenIde={openIde}
                        onRemove={removeRepo}
                        onAddToGroup={addToGroup}
                        currentGroup={groupByPath[repo.path]}
                        runningCount={runningCountFor(repo.path)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {listTab === 'stats' && (
              <section>
                <StatsPanel repos={repos} groups={groups} groupByPath={groupByPath} />
              </section>
            )}
          </div>
        )}

        {selectedGroup && !selectedRepo && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="subtle" onClick={() => setSelectedGroup(null)} className="px-2">
                  <IconChevronLeft className="h-4 w-4" />
                  Retour
                </Button>
                <h2 className="text-base font-semibold">{selectedGroup}</h2>
              </div>
              <div className="flex items-center gap-2">
                {groupRepos.length > 0 && (
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted hover:text-text">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 cursor-pointer"
                      checked={groupSelection.size > 0 && groupSelection.size === groupRepos.length}
                      onChange={(e) =>
                        setGroupSelection(e.target.checked ? new Set(groupRepos.map((r) => r.path)) : new Set())
                      }
                    />
                    Tout sélectionner
                  </label>
                )}
                <Button variant="primary" disabled={launchingGroup} onClick={() => runGroup(selectedGroup)}>
                  <IconExternal className={`h-3.5 w-3.5 ${launchingGroup ? 'animate-spin' : ''}`} />
                  {launchingGroup
                    ? 'Lancement…'
                    : groupSelection.size > 0
                      ? `Lancer la sélection (${groupSelection.size})`
                      : 'Lancer le groupe'}
                </Button>
                {(() => {
                  const scope = groupSelection.size > 0 ? [...groupSelection] : groupRepos.map((r) => r.path)
                  const active = scope.reduce((n, p) => n + runningCountFor(p), 0)
                  return (
                    <Button variant="ghost" disabled={active === 0} onClick={() => stopAllFor(scope)}>
                      <IconClose className="h-3.5 w-3.5" />
                      {groupSelection.size > 0 ? `Arrêter la sélection (${active})` : `Tout arrêter (${active})`}
                    </Button>
                  )
                })()}
                <Button variant="danger" onClick={() => deleteGroup(selectedGroup)}>
                  <IconTrash className="h-3.5 w-3.5" />
                  Supprimer le groupe
                </Button>
              </div>
            </div>
            {groupRepos.length === 0 ? (
              <EmptyState message="Ce groupe est vide — ajoute des projets depuis la liste principale." />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groupRepos.map((repo) => (
                  <RepoCard
                    key={repo.path}
                    repo={repo}
                    groups={groups}
                    ides={ides}
                    groupContext={selectedGroup}
                    onOpen={(r) => setSelectedPath(r.path)}
                    onOpenIde={openIde}
                    onRemoveFromGroup={removeFromGroup}
                    selectable
                    selected={groupSelection.has(repo.path)}
                    onToggleSelect={toggleGroupSelection}
                    runningCount={runningCountFor(repo.path)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {selectedRepo && (
          <RepoDetail
            repo={selectedRepo}
            ides={ides}
            terminals={terminals}
            runningConfigs={Object.fromEntries(
              Object.entries(runningMeta)
                .filter(([, meta]) => meta.realPath === selectedRepo.path)
                .map(([key, meta]) => [meta.configName, { key, terminalId: meta.terminalId, running: runningPaths.has(key) }])
            )}
            onStartRun={(path, name, url) => startRun(path, name, selectedRepo.name, url)}
            onStopRun={stopRun}
            onClearRun={clearRunEntry}
            onBack={() => setSelectedPath(null)}
            onRefreshList={refresh}
            onNotify={notify}
          />
        )}
      </main>
    </div>
  )
}

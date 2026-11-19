import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconFile, IconFolder } from './icons'
import { EmptyState } from './emptyState'

// The "Sorties" tab: what the project's builds produced (jars, zips, installers, a dist/ folder…)
// listed with where they are, so there is no hunting for them afterwards. When the last run
// started from Dev Hub is known, the files it produced come first.

function api() {
  return window.pywebview?.api
}

const POLL_MS = 8000
const FILTERS = [
  ['all', 'Tout'],
  ['app', 'Applications'],
  ['archive', 'Archives'],
  ['folder', 'Dossiers'],
]
const KIND_TONE = {
  app: 'bg-accent-bg text-accent',
  archive: 'bg-warning/15 text-warning',
  folder: 'bg-success/15 text-success',
}

function size(n) {
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mo`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} Go`
}

function ago(seconds, now) {
  const s = Math.max(0, now - seconds)
  if (s < 60) return "à l'instant"
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  return `il y a ${Math.floor(s / 86400)} j`
}

function Row({ e, now, fresh, onReveal, onCopy }) {
  const dir = e.rel.includes('/') ? e.rel.slice(0, e.rel.lastIndexOf('/')) : ''
  return (
    <div className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover/50">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${KIND_TONE[e.kind] || KIND_TONE.app}`}>
        {e.kind === 'folder' ? <IconFolder className="h-4 w-4" /> : <IconFile className="h-4 w-4" />}
      </span>
      <button type="button" onClick={() => onReveal(e)} className="min-w-0 flex-1 cursor-pointer text-left" title="Afficher dans l'explorateur">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-text">{e.name}</span>
          {e.ext && <span className="shrink-0 rounded border border-border px-1 font-mono text-[10px] uppercase text-muted">{e.ext}</span>}
          {fresh && <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white">nouveau</span>}
        </span>
        <span className="block truncate font-mono text-[11.5px] text-muted" title={e.abs}>
          {dir || '.'}
          {e.count != null && ` · ${e.count.toLocaleString('fr-FR')} fichiers`}
        </span>
      </button>
      <span className="hidden shrink-0 items-center gap-3 text-[12px] group-hover:flex">
        <button type="button" onClick={() => onCopy(e.abs, 'Chemin copié')} className="cursor-pointer text-muted hover:text-text">
          Copier le chemin
        </button>
        <button type="button" onClick={() => onReveal(e)} className="cursor-pointer text-accent hover:underline">
          {e.kind === 'folder' ? 'Ouvrir' : 'Afficher'}
        </button>
      </span>
      <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-muted">{size(e.size)}</span>
      <span className="w-24 shrink-0 text-right text-[12px] text-muted">{ago(e.mtime, now)}</span>
    </div>
  )
}

export function OutputsPanel({ repo, onNotify, active, refreshSignal, seenBefore }) {
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    const r = await api()?.outputs_list?.(repo.path)
    setBusy(false)
    if (r && !r.error) setData(r)
  }, [repo.path])

  // On open, when the window is back in front, on "Rafraîchir", and every few seconds while the tab is showing:
  // a build running in another window drops its files in the meantime.
  useEffect(() => {
    load()
  }, [load, refreshSignal])
  useEffect(() => {
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])
  useEffect(() => {
    if (!active) return undefined
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [active, load])

  async function reveal(e) {
    const r = await api()?.outputs_reveal?.(repo.path, e.rel)
    if (r?.error) onNotify?.(r.error, true)
  }

  function copy(text, message) {
    navigator.clipboard?.writeText(text).then(() => onNotify?.(message))
  }

  const entries = useMemo(() => (data?.entries || []).filter((e) => filter === 'all' || e.kind === filter), [data, filter])
  const last = data?.last_run
  // Files written since the last run started (a little slack: clocks and file systems round times).
  const isFresh = (e) => !!last && e.mtime >= last.started - 2
  // The "nouveau" tag lasts until the next visit: it marks what appeared since you last looked here.
  const isNew = (e) => (seenBefore != null ? e.mtime > seenBefore : isFresh(e))
  const fresh = entries.filter(isFresh)
  const others = entries.filter((e) => !isFresh(e))
  const now = data?.now || Date.now() / 1000

  const counts = useMemo(() => {
    const c = { all: 0, app: 0, archive: 0, folder: 0 }
    for (const e of data?.entries || []) {
      c.all++
      c[e.kind]++
    }
    return c
  }, [data])

  return (
    <div className="pt-2">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          Sorties <span className="ml-1 tabular-nums text-muted/70">{counts.all || ''}</span>
        </h3>
        {/* Only worth showing when there are at least two kinds of output to tell apart. */}
        {FILTERS.filter(([id]) => id !== 'all' && counts[id] > 0).length > 1 && (
          <div className="flex items-center gap-0.5 rounded-md bg-surface-hover/50 p-0.5 text-[12px]">
            {FILTERS.filter(([id]) => id === 'all' || counts[id] > 0).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                title={{ all: 'Toutes les sorties', app: 'Programmes et paquets : .jar, .exe, .msi, .apk…', archive: 'Archives : .zip, .tar.gz, .whl…', folder: 'Dossiers de build : dist, out…' }[id]}
                className={`cursor-pointer rounded px-2.5 py-1 ${filter === id ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={load} disabled={busy} className="ml-auto cursor-pointer text-[12px] text-muted hover:text-text disabled:opacity-50">
          {busy ? 'Analyse…' : 'Actualiser'}
        </button>
      </div>

      {last && (
        <p className="mb-3 flex items-center gap-2 text-[12.5px] text-muted">
          <span className={`h-2 w-2 shrink-0 rounded-full ${last.ended ? (last.code ? 'bg-danger' : 'bg-success') : 'animate-pulse bg-accent'}`} />
          {last.ended ? (
            <>
              Dernier lancement : <span className="text-text">« {last.name} »</span> terminé {ago(last.ended, now)}
              {last.code ? ` (code ${last.code})` : ''}
              {' · '}
              {fresh.length ? `${fresh.length} fichier${fresh.length > 1 ? 's' : ''} produit${fresh.length > 1 ? 's' : ''}` : 'aucun fichier produit dans les sorties connues'}
            </>
          ) : (
            <>
              <span className="text-text">« {last.name} »</span> est en cours…
            </>
          )}
        </p>
      )}

      {data && entries.length === 0 && (
        <EmptyState title="Aucune sortie pour l'instant">
          Lance un build : les jars, zips, exécutables, APK et dossiers <code className="text-text">dist</code> / <code className="text-text">build</code> /<code className="text-text"> target</code> apparaîtront ici.
        </EmptyState>
      )}
      {!data && <p className="py-8 text-center text-[13px] text-muted">Recherche des sorties…</p>}

      {fresh.length > 0 && (
        <>
          <p className="px-2 pb-1 pt-1 text-[11px] uppercase tracking-[0.08em] text-muted">Produits par « {last.name} »</p>
          {fresh.map((e) => (
            <Row key={e.abs} e={e} now={now} fresh={isNew(e)} onReveal={reveal} onCopy={copy} />
          ))}
        </>
      )}
      {others.length > 0 && (
        <>
          {fresh.length > 0 && <p className="px-2 pb-1 pt-4 text-[11px] uppercase tracking-[0.08em] text-muted">Autres sorties</p>}
          {others.map((e) => (
            <Row key={e.abs} e={e} now={now} fresh={isNew(e)} onReveal={reveal} onCopy={copy} />
          ))}
        </>
      )}
    </div>
  )
}

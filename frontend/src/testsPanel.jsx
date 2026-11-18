import { useCallback, useEffect, useRef, useState } from 'react'

// The "Tests" tab: run the project's test command, watch it, and read the result
// as a list (failures with their file and line) instead of a wall of console text.

function api() {
  return window.pywebview?.api
}

const lastKey = (p) => `devhub.testsLast::${p}`
const cmdKey = (p) => `devhub.testsCmd::${p}`
const FAILURES_SHOWN = 30 // a broken suite can list hundreds: show the first ones, the rest on demand

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function ago(ts) {
  if (!ts) return ''
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return "à l'instant"
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  return `il y a ${Math.floor(s / 86400)} j`
}

function Stat({ tone, n, label }) {
  const color = { ok: 'text-success', bad: 'text-danger', mute: 'text-muted' }[tone]
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`text-[20px] font-semibold tabular-nums ${color}`}>{n}</span>
      <span className="text-[12px] text-muted">{label}</span>
    </span>
  )
}

export function TestsPanel({ repo, setup, renderOutput, onOpenFile, onAskAi, onNotify }) {
  const [command, setCommand] = useState(() => localStorage.getItem(cmdKey(repo.path)) || setup?.command || '')
  const [phase, setPhase] = useState('idle') // idle | running | done
  const [terminalId, setTerminalId] = useState(null)
  const [report, setReport] = useState(null)
  const [last, setLast] = useState(() => readJson(lastKey(repo.path)))
  const [showOutput, setShowOutput] = useState(true)
  const [open, setOpen] = useState(() => new Set())
  const [showAllFailures, setShowAllFailures] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [, setTick] = useState(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // The command is the project's own unless it was edited by hand.
  useEffect(() => {
    if (!localStorage.getItem(cmdKey(repo.path)) && setup?.command) setCommand(setup.command)
  }, [setup?.command, repo.path])

  const run = useCallback(async () => {
    if (!command.trim()) return
    localStorage.setItem(cmdKey(repo.path), command.trim())
    setReport(null)
    setOpen(new Set())
    setShowAllFailures(false)
    const r = await api()?.start_test_run?.(repo.path, command.trim(), 24, 110)
    if (r?.error || !r?.terminal_id) {
      onNotify?.(r?.error || 'Impossible de lancer les tests', true)
      return
    }
    setTerminalId(r.terminal_id)
    setStartedAt(Date.now())
    setShowOutput(true)
    setPhase('running')
  }, [command, repo.path, onNotify])

  async function stop() {
    if (terminalId) await api()?.stop_test_run?.(terminalId)
  }

  // Waits for the end of the run, then reads the report.
  useEffect(() => {
    if (phase !== 'running' || !terminalId) return undefined
    let stopped = false
    const id = setInterval(async () => {
      setTick((n) => n + 1)
      const st = await api()?.test_run_state?.(terminalId)
      if (stopped || !st || st.error || !st.finished) return
      stopped = true
      clearInterval(id)
      const rep = await api()?.test_run_report?.(terminalId, '')
      if (!alive.current) return
      if (rep && !rep.error) {
        setReport(rep)
        const summary = { when: Date.now(), ok: rep.ok, passed: rep.passed, failed: rep.failed, skipped: rep.skipped, total: rep.total, duration: rep.duration }
        setLast(summary)
        localStorage.setItem(lastKey(repo.path), JSON.stringify(summary))
        setShowOutput(false) // the result is the list above; the console stays one click away
      }
      setPhase('done')
    }, 700)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [phase, terminalId, repo.path])

  function toggle(i) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function askAi(allFailures) {
    const list = failures
      .slice(0, 8)
      .map((f) => `- ${f.name}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}${f.message ? ` : ${f.message.split('\n')[0].slice(0, 200)}` : ''}`)
      .join('\n')
    onAskAi?.(
      `Les tests de ce projet échouent (commande : ${command.trim()}).\n${list}\n\nTrouve la cause et corrige le code, ou le test s'il est faux. Relance les tests ensuite.`,
    )
  }

  const running = phase === 'running'
  const shown = report || null
  const elapsed = running ? Math.round((Date.now() - startedAt) / 1000) : 0
  const allFailures = shown?.failures || []
  const failures = showAllFailures ? allFailures : allFailures.slice(0, FAILURES_SHOWN)
  const allGreen = shown && shown.ok && shown.failed === 0

  return (
    <div className="flex flex-col gap-4">
      {/* command + run */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
        <span className="rounded border border-border px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-muted">{setup?.label || 'Tests'}</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !running && run()}
          spellCheck={false}
          placeholder="Commande de test (ex. npm test)"
          className="min-w-[14rem] flex-1 rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-[12.5px] text-text outline-none focus:border-accent"
        />
        {command.trim() !== (setup?.command || '') && setup?.command && (
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(cmdKey(repo.path))
              setCommand(setup.command)
            }}
            className="cursor-pointer text-[11.5px] text-muted hover:text-text"
            title={`Revenir à « ${setup.command} »`}
          >
            Rétablir
          </button>
        )}
        {running ? (
          <button
            type="button"
            onClick={stop}
            className="flex cursor-pointer items-center gap-2 rounded-md bg-danger px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
          >
            <span className="h-2.5 w-2.5 rounded-sm bg-white" />
            Arrêter
          </button>
        ) : (
          <button
            type="button"
            onClick={run}
            disabled={!command.trim()}
            className="flex cursor-pointer items-center gap-2 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="text-[11px]">▶</span>
            {phase === 'done' ? 'Relancer' : 'Lancer les tests'}
          </button>
        )}
      </div>

      {/* state */}
      {running && (
        <div className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-bg px-4 py-3 text-[13px] text-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          Tests en cours… {elapsed} s
        </div>
      )}

      {!running && shown && (
        <div className={`rounded-xl border px-4 py-3 ${allGreen ? 'border-success/40 bg-success-bg' : 'border-danger/40 bg-danger-bg'}`}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className={`text-[14px] font-semibold ${allGreen ? 'text-success' : 'text-danger'}`}>
              {allGreen ? '✓ Tous les tests passent' : shown.failed > 0 ? `✕ ${shown.failed} test${shown.failed > 1 ? 's' : ''} en échec` : '✕ Les tests ont échoué'}
            </span>
            {shown.total > 0 && (
              <>
                <Stat tone="ok" n={shown.passed} label="réussis" />
                {shown.failed > 0 && <Stat tone="bad" n={shown.failed} label="échoués" />}
                {shown.skipped > 0 && <Stat tone="mute" n={shown.skipped} label="ignorés" />}
              </>
            )}
            <span className="ml-auto text-[12px] text-muted">{shown.duration} s</span>
          </div>
        </div>
      )}

      {!running && !shown && last && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-[13px] text-muted">
          <span className={last.ok ? 'text-success' : 'text-danger'}>{last.ok ? '✓' : '✕'}</span>
          Dernier lancement {ago(last.when)} :
          <span className="text-text">
            {last.passed} réussi{last.passed > 1 ? 's' : ''}
            {last.failed ? `, ${last.failed} échoué${last.failed > 1 ? 's' : ''}` : ''}
          </span>
        </div>
      )}

      {!running && !shown && !last && (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">
          Lance les tests pour voir le résultat ici.
        </div>
      )}

      {/* failures */}
      {!running && allFailures.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-3 border-b border-border px-4 py-2">
            <span className="text-[12px] font-medium uppercase tracking-wide text-muted">Échecs</span>
            {onAskAi && (
              <button
                type="button"
                onClick={() => askAi(allFailures)}
                className="ml-auto cursor-pointer rounded-md border border-accent/50 bg-accent-bg px-2.5 py-1 text-[12px] text-text hover:border-accent"
              >
                Corriger avec l'IA
              </button>
            )}
          </div>
          {failures.map((f, i) => (
            <div key={`${f.name}-${i}`} className="border-b border-border/70 last:border-b-0">
              <div className="flex items-start gap-3 px-4 py-2.5">
                <span className="mt-0.5 text-danger">✕</span>
                <button type="button" onClick={() => toggle(i)} className="min-w-0 flex-1 cursor-pointer text-left">
                  <span className="block truncate font-mono text-[12.5px] text-text">{f.name}</span>
                  {f.message && <span className="mt-0.5 block truncate text-[12px] text-muted">{f.message.split('\n')[0]}</span>}
                </button>
                {f.file && (
                  <button
                    type="button"
                    onClick={() => onOpenFile?.(f.file, f.line)}
                    className="shrink-0 cursor-pointer rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted hover:border-border-strong hover:text-text"
                    title="Ouvrir dans l'onglet Code"
                  >
                    {f.file.split('/').pop()}
                    {f.line ? `:${f.line}` : ''}
                  </button>
                )}
              </div>
              {open.has(i) && (f.trace || f.message) && (
                <pre className="mx-4 mb-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-base px-3 py-2 font-mono text-[11.5px] leading-snug text-muted ring-1 ring-border">
                  {f.trace || f.message}
                </pre>
              )}
            </div>
          ))}
          {allFailures.length > failures.length && (
            <button type="button" onClick={() => setShowAllFailures(true)} className="w-full cursor-pointer border-t border-border/70 px-4 py-2 text-[12px] text-muted hover:text-text">
              Voir les {allFailures.length - failures.length} autres échecs
            </button>
          )}
        </div>
      )}

      {/* console */}
      {terminalId && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <button
            type="button"
            onClick={() => setShowOutput((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-[12px] text-muted hover:text-text"
          >
            <span className={`text-[9px] transition-transform ${showOutput ? 'rotate-90' : ''}`}>▶</span>
            Sortie de la console
          </button>
          <div className={showOutput ? 'flex h-[300px] flex-col border-t border-border' : 'hidden'}>{renderOutput(terminalId)}</div>
        </div>
      )}
    </div>
  )
}

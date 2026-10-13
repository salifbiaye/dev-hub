import { useEffect, useState } from 'react'
import { IconCheck, IconChevronLeft, IconRefresh } from './icons'

function api() {
  return window.pywebview?.api
}

const ICON = '/hubi/hubi-icon.png'

// How each mascot is previewed from the single artwork (the light one).
const MASCOT_PREVIEW = {
  light: { filter: 'none', hint: 'Blanc, toujours' },
  graphite: { filter: 'invert(0.86) hue-rotate(180deg)', hint: 'Gris foncé, discret' },
  auto: { filter: 'none', hint: 'Blanc éveillé, gris quand il dort', split: true },
}
const SIZE_LABELS = { S: 'Petit', M: 'Moyen', L: 'Grand', XL: 'Très grand' }

function Switch({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${
        checked ? 'bg-accent' : 'bg-border-strong'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`}
      />
    </button>
  )
}

function Row({ title, hint, children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-48 flex-1">
        <p className="text-[13px] text-text">{title}</p>
        {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className="divide-y divide-border rounded-xl border border-border bg-base px-4">{children}</div>
    </section>
  )
}

/**
 * Dev Hub's Hubi page (a full page, like a project): everything about the companion in one place (it used
 * to be scattered through the Outils menu). Hubi itself is a separate process;
 * mascot / size / theme / sound go through config.json and it picks them up
 * on its next poll.
 */
export function HubiPage({ hubi, onState, onClose, onNotify, onOpenTasks, onOpenTimer }) {
  const [busy, setBusy] = useState(null)
  const [openTasks, setOpenTasks] = useState(null)

  useEffect(() => {
    api()
      ?.hubi_tasks_list?.()
      ?.then((r) => setOpenTasks((r?.tasks || []).filter((t) => !t.done).length))
  }, [])

  async function call(key, fn, okMessage) {
    setBusy(key)
    const r = await fn()
    setBusy(null)
    if (r?.error) onNotify(r.error, true)
    else if (okMessage) onNotify(typeof okMessage === 'function' ? okMessage(r) : okMessage)
    if (r && 'running' in r) onState(r)
  }

  const setOption = (key, value) => call(key, () => api()?.hubi_set_option?.(key, value))
  const running = !!hubi.running
  const mascots = hubi.mascots || [
    { id: 'light', label: 'Hubi clair' },
    { id: 'graphite', label: 'Hubi graphite' },
    { id: 'auto', label: 'Hubi auto' },
  ]

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <IconChevronLeft className="h-4 w-4" />
          Retour
        </button>
        <span className="text-[12px] text-muted/60">/</span>
        <span className="text-[12px] text-text">Hubi</span>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface px-7 pt-7 pb-6">
          <div
            className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full opacity-25 blur-3xl"
            style={{ background: running ? 'var(--color-accent)' : 'transparent' }}
          />
          <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <img
              src={ICON}
              alt="Hubi"
              className={`h-24 w-32 shrink-0 object-contain drop-shadow-xl transition-all duration-500 ${
                running ? '' : 'opacity-50 grayscale'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-semibold tracking-tight">Hubi</h2>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                    running ? 'bg-success-bg text-success' : 'bg-surface-hover text-muted'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-success' : 'bg-muted'}`} />
                  {running ? 'En marche' : 'Arrêté'}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                Ton compagnon de bureau : il suit tes sessions Claude, tes runs, ton minuteur et tes tâches, même Dev Hub
                fermé.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  disabled={busy === 'running'}
                  onClick={() => call('running', () => api()?.hubi_set_running?.(!running))}
                  className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60 ${
                    running ? 'border border-border-strong text-text' : 'bg-accent text-white shadow-sm'
                  }`}
                >
                  {running ? 'Arrêter Hubi' : 'Lancer Hubi'}
                </button>
                <span className="text-[11px] text-muted">
                  <kbd className="rounded border border-border bg-base px-1 font-mono text-[10px] text-text">Ctrl+Alt+H</kbd> ajoute
                  une tâche de n'importe où
                </span>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="relative mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {[
              {
                key: 'tasks',
                icon: <IconCheck className="h-4 w-4" />,
                title: 'Tâches',
                sub: openTasks == null ? '…' : openTasks ? `${openTasks} à faire` : 'Rien à faire',
                onClick: onOpenTasks,
              },
              { key: 'timer', icon: <IconRefresh className="h-4 w-4" />, title: 'Minuteur', sub: 'Lancer un compte à rebours', onClick: onOpenTimer },
            ].map((a) => (
              <button
                key={a.key}
                onClick={a.onClick}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-base px-3.5 py-3 text-left transition-colors hover:border-accent"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-bg text-accent">{a.icon}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-text">{a.title}</span>
                  <span className="block truncate text-[11px] text-muted">{a.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
          <section>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Mascotte</h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {mascots.map((m) => {
                const pv = MASCOT_PREVIEW[m.id] || MASCOT_PREVIEW.light
                const active = hubi.mascot === m.id
                return (
                  <button
                    key={m.id}
                    onClick={() => setOption('mascot', m.id)}
                    className={`relative cursor-pointer rounded-xl border p-3 text-left transition-colors ${
                      active ? 'border-accent bg-accent-bg' : 'border-border bg-base hover:border-border-strong'
                    }`}
                  >
                    <div className="flex h-16 items-center justify-center rounded-lg bg-[#0b0b0d]">
                      {pv.split ? (
                        <span className="flex items-center gap-1.5">
                          <img src={ICON} alt="" className="h-9 w-12 object-contain" />
                          <img src={ICON} alt="" className="h-9 w-12 object-contain" style={{ filter: MASCOT_PREVIEW.graphite.filter }} />
                        </span>
                      ) : (
                        <img src={ICON} alt="" className="h-11 w-14 object-contain" style={{ filter: pv.filter }} />
                      )}
                    </div>
                    <p className="mt-2 text-[12px] font-medium text-text">{m.label.replace(/ \(.*\)$/, '')}</p>
                    <p className="text-[10.5px] leading-snug text-muted">{pv.hint}</p>
                    {active && (
                      <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white">
                        <IconCheck className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>

          <Section title="Apparence">
            <Row title="Taille" hint="Hubi garde son coin de l'écran, seul le bord gauche bouge.">
              <div className="flex shrink-0 rounded-lg border border-border bg-surface p-0.5">
                {(hubi.sizes || ['S', 'M', 'L', 'XL']).map((s) => (
                  <button
                    key={s}
                    title={SIZE_LABELS[s]}
                    onClick={() => setOption('size', s)}
                    className={`min-w-8 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      hubi.size === s ? 'bg-accent text-white' : 'text-muted hover:text-text'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Row>
            <Row title="Couleurs du thème Dev Hub" hint="La tablette de Hubi prend la couleur d'accent de ton thème.">
              <Switch checked={!!hubi.follow_theme} disabled={busy === 'follow_theme'} onChange={(v) => setOption('follow_theme', v)} />
            </Row>
            <Row title="Sons" hint="Petit signal quand une session se termine, une erreur arrive ou le minuteur sonne.">
              <button
                onClick={() => call('test_sound', () => api()?.hubi_test_sound?.())}
                disabled={busy === 'test_sound'}
                className="shrink-0 cursor-pointer rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:border-border-strong hover:text-text disabled:cursor-wait"
              >
                Tester
              </button>
              <Switch checked={!!hubi.sound} disabled={busy === 'sound'} onChange={(v) => setOption('sound', v)} />
            </Row>
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          <Section title="Intégration">
            <Row
              title={`Notifications de l'agent IA${hubi.agent_label ? ` (${hubi.agent_label})` : ''}`}
              hint={
                hubi.agent_label
                  ? `Hubi suit tes sessions ${hubi.agent_label} : en cours (avec leur nombre), en attente de réponse, terminées ou en erreur. Il suit l'agent choisi dans Paramètres IA.`
                  : 'Choisis Claude Code ou Codex dans Paramètres IA pour que Hubi suive tes sessions.'
              }
            >
              <Switch
                checked={!!hubi.agent_notify}
                disabled={busy === 'agent_notify' || !hubi.agent_label}
                onChange={(v) =>
                  call('agent_notify', () => api()?.hubi_set_agent_notify?.(v), (r) =>
                    r.agent_notify ? `Hubi suit tes sessions ${r.agent_label}` : `Hubi ne suit plus tes sessions ${r.agent_label}`,
                  )
                }
              />
            </Row>
            <Row title="Démarrer avec Windows" hint="Hubi s'ouvre tout seul à la connexion, sans Dev Hub.">
              <Switch checked={!!hubi.autostart} disabled={busy === 'autostart'} onChange={(v) => call('autostart', () => api()?.hubi_set_autostart?.(v))} />
            </Row>
            <Row title="Raccourci sur le bureau" hint="Une icône Hubi pour le lancer d'un double-clic.">
              <Switch checked={!!hubi.shortcut} disabled={busy === 'shortcut'} onChange={(v) => call('shortcut', () => api()?.hubi_set_shortcut?.(v))} />
            </Row>
          </Section>
          <Section title="Bon à savoir">
            <Row
              title="Hubi vit sans Dev Hub"
              hint="Il tourne dans son propre processus : tu peux fermer Dev Hub, il continue de suivre tes sessions et ton minuteur."
            />
            <Row
              title="Le fermer ou le cacher"
              hint="Clic droit sur son icône près de l'horloge : Afficher / masquer, Quitter, tester une humeur."
            />
          </Section>
        </div>
      </div>
    </div>
  )
}

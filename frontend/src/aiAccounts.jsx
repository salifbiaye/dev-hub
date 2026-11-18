import { useCallback, useEffect, useRef, useState } from 'react'
import { IconAlertCircle, IconCheck, IconCopy, IconExternal, IconPencil, IconPlus, IconTrash } from './icons'
import { Row } from './settingsUi'

function api() {
  return window.pywebview?.api
}

const PLAN_LABELS = {
  free: 'Free',
  pro: 'Pro',
  max: 'Max',
  plus: 'Plus',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
  api: 'Clé API',
}
const planLabel = (plan) => (plan ? PLAN_LABELS[String(plan).toLowerCase()] || plan : null)

// Stable, pleasant avatar color per account.
const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444']
function avatarColor(text) {
  let h = 0
  for (const ch of text || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function Avatar({ account }) {
  const text = account.label || account.name || account.email || '?'
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
      style={{ background: avatarColor(account.email || text) }}
    >
      {text.trim().charAt(0).toUpperCase()}
    </span>
  )
}

async function copy(text) {
  try {
    const r = await api()?.copy_to_clipboard?.(text)
    if (r) return !!r.ok
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
}

// "⋯" of a row: rename / remove / sign out. Stays out of the row's own click.
function RowMenu({ account, onRename, onRemove, onLogout }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', close, true)
    return () => document.removeEventListener('mousedown', close, true)
  }, [open])
  const item = 'flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[13px] text-text hover:bg-surface-hover'
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted opacity-0 transition-opacity hover:bg-base hover:text-text focus-visible:opacity-100 group-hover/row:opacity-100"
        style={open ? { opacity: 1 } : undefined}
        title="Plus d'actions"
      >
        <span className="text-base leading-none">⋯</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-48 overflow-hidden rounded-[10px] border border-border-strong bg-surface py-1 shadow-xl">
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              onRename()
            }}
          >
            <IconPencil className="h-3.5 w-3.5 text-muted" />
            Renommer
          </button>
          {account.active ? (
            <button
              className={`${item} !text-danger`}
              onClick={() => {
                setOpen(false)
                onLogout()
              }}
            >
              <IconAlertCircle className="h-3.5 w-3.5" />
              Se déconnecter
            </button>
          ) : (
            <button
              className={`${item} !text-danger`}
              onClick={() => {
                setOpen(false)
                onRemove()
              }}
            >
              <IconTrash className="h-3.5 w-3.5" />
              Retirer de la liste
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function AccountRow({ account, busy, onUse, onRename, onRemove, onLogout }) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(account.label)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const plan = planLabel(account.plan)
  const title = account.label || account.name || account.email || 'Compte'
  const subtitle = [account.email, account.org && !/organization/i.test(account.org) ? account.org : null]
    .filter(Boolean)
    .join(' · ')

  function commitRename() {
    setEditing(false)
    if (label.trim() !== account.label) onRename(label.trim())
  }

  const right = confirmRemove ? (
    <span className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setConfirmRemove(false)} className="cursor-pointer text-[13px] text-muted hover:text-text">
        Annuler
      </button>
      <button
        onClick={() => {
          setConfirmRemove(false)
          onRemove()
        }}
        className="cursor-pointer text-[13px] font-medium text-danger"
      >
        Retirer
      </button>
    </span>
  ) : (
    <>
      {plan && <span className="text-[12.5px]">{plan}</span>}
      {account.active ? <IconCheck className="h-[18px] w-[18px] text-accent" /> : <span className="w-[18px]" />}
      <RowMenu
        account={account}
        onRename={() => {
          setLabel(account.label)
          setEditing(true)
        }}
        onRemove={() => setConfirmRemove(true)}
        onLogout={onLogout}
      />
    </>
  )

  return (
    <Row
        inset
        leading={<Avatar account={account} />}
        title={
          editing ? (
            <input
              autoFocus
              value={label}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditing(false)
              }}
              placeholder={account.name || account.email}
              maxLength={40}
              className="w-full border-b border-accent bg-transparent text-[14px] text-text outline-none"
            />
          ) : (
            title
          )
        }
        subtitle={editing ? undefined : subtitle}
        onClick={account.active || busy || editing || confirmRemove ? undefined : onUse}
        right={right}
      />
  )
}

/**
 * The rows of one agent's accounts (Claude Code or Codex), meant to sit inside
 * a settings Group: who is signed in (✓), the other accounts one tap away,
 * and "Ajouter un compte…" which runs the browser sign-in.
 */
export function AccountRows({ agent, installed, onNotify, label }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [login, setLogin] = useState({ state: 'idle' })
  // App recreates onNotify on every render: keeping it out of the effects'
  // dependencies avoids reloading the accounts in a loop.
  const notifyRef = useRef(onNotify)
  notifyRef.current = onNotify
  const notify = useCallback((...args) => notifyRef.current?.(...args), [])

  const reload = useCallback(async () => {
    const r = await api()?.ai_accounts_list?.(agent)
    if (r && !r.error) setData(r)
    else if (r?.error) notify(r.error, true)
  }, [agent, notify])

  useEffect(() => {
    reload()
  }, [reload])

  // While a browser sign-in is open: follow it until it ends.
  const active = login.state === 'starting' || login.state === 'waiting'
  useEffect(() => {
    if (!active) return
    const id = setInterval(async () => {
      const s = await api()?.ai_account_login_status?.(agent)
      if (!s) return
      setLogin(s)
      if (s.state === 'done') {
        notify(s.email ? `Compte ${s.email} connecté` : 'Compte connecté')
        reload()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [active, agent, reload, notify])

  async function startLogin() {
    setLogin({ state: 'starting' })
    const r = await api()?.ai_account_login_start?.(agent)
    if (r?.error) setLogin({ state: 'error', error: r.error })
    else setLogin(r)
  }

  async function cancelLogin() {
    await api()?.ai_account_login_cancel?.(agent)
    setLogin({ state: 'idle' })
    reload()
  }

  async function run(fn, okMessage) {
    setBusy(true)
    try {
      const r = await fn()
      if (r?.error) notify(r.error, true)
      else if (okMessage) notify(typeof okMessage === 'function' ? okMessage(r) : okMessage)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const accounts = data?.accounts || []
  const current = accounts.find((a) => a.active)

  return (
    <>
      {data === null && <Row title="Chargement des comptes…" tone="muted" />}
      {data !== null && accounts.length === 0 && !active && (
        <Row
          title="Aucun compte connecté"
          subtitle={`Une page de connexion ${label} s'ouvre dans ton navigateur (Google, e-mail ou SSO).`}
          tone="muted"
        />
      )}
      {accounts.map((a) => (
        <AccountRow
          key={a.id}
          account={a}
          busy={busy || active}
          onUse={() =>
            run(
              () => api().ai_account_switch(agent, a.id),
              (r) =>
                r.running > 0
                  ? `Compte actif : ${a.email || a.name}. ${r.running} session(s) ${label} ouverte(s) gardent l'ancien compte jusqu'à leur redémarrage.`
                  : `Compte actif : ${a.email || a.name}`,
            )
          }
          onRename={(name) => run(() => api().ai_account_rename(agent, a.id, name))}
          onRemove={() => run(() => api().ai_account_remove(agent, a.id), 'Compte retiré de la liste')}
          onLogout={() => run(() => api().ai_account_logout(agent), `Déconnecté de ${current?.email || label}`)}
        />
      ))}

      {active && (
        <>
          <Row
            leading={<Spinner />}
            title="Termine la connexion dans ton navigateur"
            subtitle={
              login.state === 'starting' ? 'Ouverture de la page de connexion…' : 'Google, e-mail ou SSO, selon ton compte.'
            }
          />
          {login.device_code && (
            <Row
              title="Code à saisir sur la page"
              right={<span className="font-mono text-[16px] font-semibold tracking-[0.18em] text-text">{login.device_code}</span>}
            />
          )}
          {login.url && (
            <>
              <Row
                tone="accent"
                title="Ouvrir la page de connexion"
                onClick={() => api()?.open_external?.(login.url)}
                right={<IconExternal className="h-4 w-4 text-accent" />}
              />
              <Row
                tone="accent"
                title="Copier le lien"
                onClick={async () => notify((await copy(login.url)) ? 'Lien copié' : 'Copie impossible', false)}
                right={<IconCopy className="h-4 w-4 text-accent" />}
              />
            </>
          )}
          {login.needs_code && <CodeRow agent={agent} notify={notify} />}
          <Row tone="muted" title="Annuler la connexion" onClick={cancelLogin} />
        </>
      )}

      {login.state === 'error' && (
        <>
          <Row
            leading={<IconAlertCircle className="h-5 w-5 text-danger" />}
            title="La connexion a échoué"
            subtitle={login.error || 'Réessaie dans un instant.'}
            tone="danger"
          />
          <Row tone="accent" title="Réessayer" onClick={startLogin} />
        </>
      )}

      {!active && login.state !== 'error' && data !== null && (
        <Row
          inset={false}
          tone="accent"
          title={accounts.length ? 'Ajouter un compte…' : `Se connecter à ${label}…`}
          onClick={startLogin}
          disabled={!installed || busy}
          subtitle={installed ? undefined : `${label} n'est pas installé sur cette machine`}
          leading={<IconPlus className="h-4 w-4 text-accent" />}
        />
      )}
    </>
  )
}

// "Colle le code affiché par la page", when the CLI asks for one.
function CodeRow({ agent, notify }) {
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  async function send() {
    if (!code.trim() || sending) return
    setSending(true)
    const r = await api()?.ai_account_login_code?.(agent, code)
    setSending(false)
    if (r?.error) notify(r.error, true)
    else setCode('')
  }
  return (
    <Row
      right={
        <button
          disabled={!code.trim() || sending}
          onClick={send}
          className="cursor-pointer text-[13.5px] font-medium text-accent disabled:cursor-default disabled:opacity-40"
        >
          Valider
        </button>
      }
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
        placeholder="Colle ici le code affiché par la page"
        className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-text outline-none placeholder:text-muted/60"
      />
    </Row>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// The bar under a Claude / Codex terminal: a real prompt box (multi-line,
// "/" for skills & commands, images by paste / drop / button) plus the
// shortcuts the TUI hides behind key chords (stop, rewind, mode). It only
// types into the session's PTY — the terminal above stays fully usable.

function api() {
  return window.pywebview?.api
}

const BRACKETED_START = '\x1b[200~'
const BRACKETED_END = '\x1b[201~'

const SCOPE_LABEL = { project: 'Projet', user: 'Perso', 'built-in': 'Intégré' }

// The CLI's own screens are in English; the ones everyone meets (rewind,
// summaries, permissions) are shown in French. Anything unknown stays as is.
const FR = [
  [/^rewind$/i, 'Revenir en arrière'],
  [/^restore the code and\/or conversation to the point before…?$/i, 'Restaurer le code et/ou la conversation au point juste avant…'],
  [/^confirm you want to restore to the point before you sent this message:?$/i, 'Confirmer la restauration au point juste avant ce message :'],
  [/^the conversation will be forked\.?$/i, 'La conversation sera dupliquée (une nouvelle branche).'],
  [/^the code will be unchanged\.?$/i, 'Le code ne changera pas.'],
  [/^the code will be restored.*$/i, 'Le code sera restauré.'],
  [/^\(current\)$/i, '(état actuel)'],
  [/^(⚠\s*)?no code restore$/i, '⚠ Le code ne peut pas être restauré'],
  [/^no code changes$/i, 'Aucun changement de code'],
  [/^restore code and conversation$/i, 'Restaurer le code et la conversation'],
  [/^restore conversation$/i, 'Restaurer la conversation'],
  [/^restore code$/i, 'Restaurer le code'],
  [/^summarize from here$/i, "Résumer à partir d'ici"],
  [/^summarize up to here$/i, "Résumer jusqu'ici"],
  [/^never mind$/i, 'Annuler'],
  [/^\((\d+\w?) ago\)$/i, (m) => `(il y a ${m[1].replace(/m$/, ' min').replace(/h$/, ' h').replace(/d$/, ' j').replace(/s$/, ' s')})`],
]
function fr(text) {
  const t = String(text ?? '').trim()
  for (const [re, out] of FR) {
    const m = t.match(re)
    if (m) return typeof out === 'function' ? out(m) : out
  }
  return text
}
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

function extOf(name, type) {
  const fromName = (name || '').split('.').pop()?.toLowerCase()
  if (fromName && fromName !== (name || '').toLowerCase()) return fromName
  return (type || '').split('/').pop()?.replace('jpeg', 'jpg') || 'png'
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const Svg = ({ children, className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {children}
  </svg>
)
const IconClip = (p) => (
  <Svg {...p}>
    <path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
  </Svg>
)
const IconSlash = (p) => (
  <Svg {...p}>
    <path d="M16 4 8 20" />
  </Svg>
)
const IconStop = (p) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </Svg>
)
const IconX = (p) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)

function FooterButton({ title, onClick, active, disabled, danger, children }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-6 cursor-pointer items-center gap-1.5 rounded px-2 transition-colors disabled:cursor-default disabled:opacity-40 ${
        danger
          ? 'bg-danger/15 text-danger hover:bg-danger/25'
          : active
            ? 'bg-accent-bg text-accent'
            : 'text-muted hover:bg-surface-hover hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

// Claude Code's footer names the permission mode in effect; no mention means
// the default one ("? for shortcuts"). Keys are what the TUI prints.
const MODES = {
  'bypass permissions': { label: 'Bypass', tone: 'text-danger', hint: 'Tout est autorisé sans demander' },
  'accept edits': { label: 'Auto-accept', tone: 'text-accent', hint: 'Les modifications de fichiers sont acceptées seules' },
  'plan mode': { label: 'Plan', tone: 'text-success', hint: "Réfléchit et propose un plan, sans rien modifier" },
  'auto mode': { label: 'Auto', tone: 'text-warning', hint: "L'agent décide des permissions" },
  default: { label: 'Défaut', tone: 'text-muted', hint: 'Demande avant chaque action' },
}

function readMode(screen) {
  const m = screen.match(/(bypass permissions|accept edits|plan mode|auto mode)\s+on/i)
  if (m) return m[1].toLowerCase()
  return /\? for shortcuts/i.test(screen) ? 'default' : null
}

// What the CLI has typed in its own prompt box (between the two rules), e.g.
// the message it hands back after "Restore conversation".
function readCliInput(screen) {
  const lines = String(screen || '').split('\n')
  const isRule = (l) => /^[─━═]{8,}$/.test(l.trim())
  let r2 = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isRule(lines[i])) {
      r2 = i
      break
    }
  }
  if (r2 < 2) return null
  let r1 = -1
  for (let i = r2 - 1; i >= 0 && r2 - i <= 14; i--) {
    if (isRule(lines[i])) {
      r1 = i
      break
    }
  }
  if (r1 < 0 || r2 - r1 < 2) return null
  const body = lines.slice(r1 + 1, r2).map((l, i) => (i === 0 ? l.replace(/^\s*[❯>]\s?/, '') : l.replace(/^\s{2}/, '')))
  return body.join('\n').trim()
}

export default function AiComposer({ repo, provider, terminalId, screen = '', dialog = null, controlRef, onWorking, onRestored, onRewindFailed, undoable, onRewound, onSent, onUndoRewind, onDismissUndo, onNotify }) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState(null)
  const [working, setWorking] = useState(false)
  const idleTimer = useRef(null)
  const [files, setFiles] = useState([]) // { path, name, preview }
  const [items, setItems] = useState([])
  const [kind, setKind] = useState(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuDismissed, setMenuDismissed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const textRef = useRef(null)
  const fileInputRef = useRef(null)
  const notifyRef = useRef(onNotify)
  notifyRef.current = onNotify
  // Messages written while the agent is busy wait HERE (not in the CLI's own hidden prompt, where
  // they vanished from view and then got glued to the next message), and go out one by one.
  const [queue, setQueue] = useState([]) // { id, text, files, message }
  const [inFlight, setInFlight] = useState(null) // the message just handed to the CLI, until it starts answering
  const [sentPending, setSentPending] = useState(false) // handed over, the CLI has not started working yet
  const pendingTimer = useRef(null)
  const sending = useRef(false)
  const screenRef = useRef(screen)
  screenRef.current = screen

  useEffect(() => {
    let alive = true
    api()
      ?.list_ai_commands?.(repo.path, provider || null)
      ?.then((r) => {
        if (!alive || !r) return
        setItems(r.items || [])
        setKind(r.kind)
      })
    return () => {
      alive = false
    }
  }, [repo.path, provider])

  const rewindRef = useRef(null)
  // Lets the terminal hand over keystrokes typed on its (hidden) prompt.
  useEffect(() => {
    if (!controlRef) return
    controlRef.current = {
      focus: () => textRef.current?.focus(),
      rewindTo: (message, nth, edit) => rewindRef.current?.(message, nth, edit),
      // The session is being restarted: forget what was in flight and empty the box.
      reset: () => {
        clearTimeout(rewindTimer.current)
        pendingRewind.current = null
        restoring.current = null
        instant.current = false
        setSilent(false)
        setText('')
        setFiles([])
        setQueue([])
        setInFlight(null)
        setSentPending(false)
      },
      insert: (s) => {
        setText((t) => t + s)
        textRef.current?.focus()
      },
    }
    return () => {
      controlRef.current = null
    }
  }, [controlRef])

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`
  }, [text])

  // What the CLI shows tells us its state: "esc to interrupt" only appears
  // while it works. It flickers between redraws, so going idle is debounced.
  useEffect(() => {
    if (!screen) return
    if (/esc to interrupt/i.test(screen)) {
      clearTimeout(idleTimer.current)
      idleTimer.current = null
      setWorking(true)
      clearTimeout(pendingTimer.current)
      setSentPending(false)
      setInFlight(null)
    } else if (!idleTimer.current) {
      idleTimer.current = setTimeout(() => {
        idleTimer.current = null
        setWorking(false)
      }, 1200)
    }
    if (kind === 'claude') {
      const m = readMode(screen)
      if (m) setMode(m)
    }
  }, [screen, kind])
  useEffect(() => () => {
    clearTimeout(idleTimer.current)
    clearTimeout(pendingTimer.current)
  }, [])
  useEffect(() => {
    onWorking?.(working)
  }, [working, onWorking])

  // Revoke thumbnails we created.
  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const agentLabel = kind === 'codex' ? 'Codex' : kind === 'claude' ? 'Claude' : "l'agent"
  const trigger = kind === 'codex' ? /^[/$]\S*$/ : /^\/\S*$/
  const token = text.split('\n').length === 1 && trigger.test(text) ? text : null
  const matches = useMemo(() => {
    if (token === null) return []
    const q = token.slice(1).toLowerCase()
    const scored = items.filter((i) => i.command.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
    // Commands that *start* with the query first, then the rest.
    return scored.sort((a, b) => Number(b.command.toLowerCase().startsWith(token.toLowerCase())) - Number(a.command.toLowerCase().startsWith(token.toLowerCase())))
  }, [items, token])
  const menuOpen = token !== null && !menuDismissed && matches.length > 0

  useEffect(() => {
    setMenuIndex(0)
    if (token === null) setMenuDismissed(false)
  }, [token])

  const write = useCallback(
    (data) => {
      if (!terminalId) {
        notifyRef.current?.('La session n\'est pas encore prête', true)
        return Promise.resolve(false)
      }
      return Promise.resolve(api()?.write_terminal(terminalId, data)).then((r) => {
        if (r?.error) {
          notifyRef.current?.(r.error, true)
          return false
        }
        return true
      })
    },
    [terminalId],
  )

  async function addFiles(list) {
    const picked = Array.from(list || [])
    if (!picked.length) return
    setUploading(true)
    try {
      for (const file of picked) {
        const ext = extOf(file.name, file.type)
        const dataUrl = await readAsDataUrl(file)
        const r = await api().save_ai_attachment(dataUrl, ext)
        if (r?.error) {
          notifyRef.current?.(r.error, true)
          continue
        }
        const preview = IMAGE_EXT.has(ext) ? URL.createObjectURL(file) : null
        setFiles((prev) => [...prev, { path: r.path, name: file.name || r.name, preview }])
      }
    } finally {
      setUploading(false)
      textRef.current?.focus()
    }
  }

  function removeFile(path) {
    setFiles((prev) => {
      const gone = prev.find((f) => f.path === path)
      if (gone?.preview) URL.revokeObjectURL(gone.preview)
      return prev.filter((f) => f.path !== path)
    })
  }

  // Empties the CLI's prompt. Ctrl+U deletes one line at a time and does nothing
  // on an empty one, so it is repeated for every line (Ctrl+C would also clear it,
  // but twice in a row on an empty prompt it quits the CLI).
  async function clearCliInput(current, original) {
    const lines = Math.max(String(current || '').split('\n').length, String(original || '').split('\n').length)
    for (let i = 0; i < Math.min(200, lines + 3); i++) {
      await write('\x15')
      await new Promise((r) => setTimeout(r, 12))
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const busy = working || sentPending || !!dialog
  const uid = () => Math.random().toString(36).slice(2, 9)

  function makeItem() {
    const body = text.trim()
    const refs = files.map((f) => (/\s/.test(f.path) ? `@"${f.path}"` : `@${f.path}`)).join(' ')
    return { id: uid(), text: body, files, message: [body, refs].filter(Boolean).join(body && refs ? '\n' : '') }
  }

  // Hands one message to the CLI. The Enter that submits it can get lost (the CLI is still
  // redrawing, a menu is open…) and the message then just sits in its box: check, and press again.
  async function submit(message) {
    // The CLI's own prompt must be empty, or our text lands after what is left
    // in it (a restored message, a stray key) and the two become one message.
    const leftover = !dialog ? readCliInput(screenRef.current) : ''
    if (leftover) await clearCliInput(leftover)
    // Bracketed paste keeps multi-line prompts as one message; Enter submits.
    const ok = await write(`${BRACKETED_START}${message}${BRACKETED_END}`)
    if (!ok) return false
    await sleep(120)
    await write('\r')
    const head = message.replace(/\s+/g, ' ').trim().slice(0, 20)
    for (let i = 0; i < 3; i++) {
      await sleep(600)
      const left = readCliInput(screenRef.current)
      if (!left || !left.replace(/\s+/g, ' ').includes(head)) break
      await write('\r')
    }
    return true
  }

  async function deliver(item) {
    sending.current = true
    setInFlight(item)
    setSentPending(true)
    clearTimeout(pendingTimer.current)
    pendingTimer.current = setTimeout(() => {
      setSentPending(false)
      setInFlight(null)
    }, 8000)
    try {
      const ok = await submit(item.message)
      if (!ok) {
        // Not delivered: give it back to the input instead of losing it.
        clearTimeout(pendingTimer.current)
        setSentPending(false)
        setInFlight(null)
        setText(item.text)
        setFiles(item.files)
        return
      }
      onSent?.()
      item.files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview))
    } finally {
      sending.current = false
    }
  }

  async function send() {
    if ((!text.trim() && !files.length) || uploading) return
    const item = makeItem()
    // Leaves the box at once: the message is visibly taken into account.
    setText('')
    setFiles([])
    if (busy || sending.current) {
      setQueue((q) => [...q, item])
      return
    }
    await deliver(item)
  }

  // Next queued message goes out when the agent is free (and nothing is waiting on a question).
  useEffect(() => {
    if (!queue.length || busy || sending.current || !terminalId) return
    const [next, ...rest] = queue
    setQueue(rest)
    deliver(next)
  }, [queue, busy, terminalId]) // eslint-disable-line react-hooks/exhaustive-deps

  function dropQueued(id) {
    setQueue((q) => {
      const gone = q.find((x) => x.id === id)
      gone?.files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview))
      return q.filter((x) => x.id !== id)
    })
  }

  // Back into the input to be edited; whatever was being typed takes its place in the queue.
  function editQueued(id) {
    const idx = queue.findIndex((x) => x.id === id)
    if (idx < 0) return
    const item = queue[idx]
    const current = text.trim() || files.length ? makeItem() : null
    setQueue((q) => {
      const copy = [...q]
      copy.splice(idx, 1, ...(current ? [current] : []))
      return copy
    })
    setText(item.text)
    setFiles(item.files)
    requestAnimationFrame(() => textRef.current?.focus())
  }

  function pickCommand(item) {
    setText(`${item.command} `)
    setMenuDismissed(true)
    requestAnimationFrame(() => {
      const el = textRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    })
  }

  // Answer the CLI's question by moving its ❯ marker (arrow keys), then Enter.
  const answering = useRef(false)
  // "Restore conversation" hands the message back to be edited — in the CLI's
  // own prompt box, which we hide. So we watch for it and move it into the
  // composer (see the effect below).
  const restoring = useRef(null)
  function noteChoice(index) {
    const label = String(dialog?.options?.[index] || '').replace(/^\d+\.\s*/, '').trim()
    if (/^restore (code and )?conversation$/i.test(label)) restoring.current = { until: Date.now() + 10000 }
    else if (/confirm you want to restore/i.test(dialog?.title || '')) restoreMessage.current = null // summarize / never mind
  }
  async function choose(index) {
    if (!dialog || answering.current) return
    noteChoice(index)
    answering.current = true
    try {
      const delta = index - dialog.selected
      const key = delta > 0 ? '\x1b[B' : '\x1b[A'
      for (let i = 0; i < Math.abs(delta); i++) {
        await write(key)
        await new Promise((r) => setTimeout(r, 40))
      }
      await write('\r')
    } finally {
      answering.current = false
    }
  }

  function onKeyDown(e) {
    if (dialog && !text) {
      const n = dialog.options.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        write(e.key === 'ArrowDown' ? '\x1b[B' : '\x1b[A')
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        noteChoice(dialog.selected)
        write('\r')
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        write('\x1b')
        return
      }
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) {
        e.preventDefault()
        choose(Number(e.key) - 1)
        return
      }
    }
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = matches.length
        setMenuIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        pickCommand(matches[menuIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenuDismissed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  function onPaste(e) {
    const pasted = Array.from(e.clipboardData?.files || [])
    if (pasted.length) {
      e.preventDefault()
      addFiles(pasted)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer?.files)
  }

  function openSlashMenu() {
    setMenuDismissed(false)
    setText((t) => (t.startsWith('/') || t.startsWith('$') ? t : '/'))
    textRef.current?.focus()
  }

  const rewind = () => (kind === 'claude' ? write('/rewind\r') : write('\x1b').then(() => setTimeout(() => write('\x1b'), 90)))
  // "Revenir ici" on a message of the conversation: open the CLI's rewind list,
  // then pick that message in it. What to restore (code, conversation) is left
  // to the person, in the card that follows.
  useEffect(() => {
    const r = restoring.current
    if (!r || dialog) return
    if (Date.now() > r.until) {
      restoring.current = null
      return
    }
    const typed = readCliInput(screen)
    if (!typed) return // the CLI hasn't redrawn its prompt yet
    restoring.current = null
    // The CLI shows long or pasted messages abbreviated ("[...Truncated text
    // #2…]"): the whole original comes from the transcript when we have it.
    const original = restoreMessage.current
    restoreMessage.current = null
    clearCliInput(typed, original) // the CLI keeps its own copy: sending from here would paste after it
    clearTimeout(rewindTimer.current)
    setSilent(false)
    if (instant.current) {
      // "Rembobiner": the box and the conversation were updated at the click.
      instant.current = false
      return
    }
    setText(original || typed)
    onRestored?.(typed)
    requestAnimationFrame(() => {
      const el = textRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    })
  }, [screen, dialog]) // eslint-disable-line react-hooks/exhaustive-deps
  const pendingRewind = useRef(null)
  const rewindTimer = useRef(null)
  const instant = useRef(false) // a "Rembobiner" is running behind an already-updated screen
  const [silent, setSilent] = useState(false) // hide the CLI's rewind questions while we answer them
  const restoreMessage = useRef(null) // full text of the message "revenir ici" was clicked on
  rewindRef.current = async (message, nth, edit) => {
    restoreMessage.current = message
    if (edit) {
      // Direct: the message is back in the box and the conversation cut at once;
      // the CLI's own rewind (two questions) runs behind, out of sight.
      instant.current = true
      setSilent(true)
      setText(message)
      onRestored?.(message)
      onRewound?.()
      requestAnimationFrame(() => {
        const el = textRef.current
        if (el) {
          el.focus()
          el.setSelectionRange(el.value.length, el.value.length)
        }
      })
      clearTimeout(rewindTimer.current)
      rewindTimer.current = setTimeout(() => {
        if (!pendingRewind.current && !restoring.current) return
        // It didn't go through: close whatever the CLI is asking, put the
        // conversation back as it is on disk, and say so.
        pendingRewind.current = null
        restoring.current = null
        instant.current = false
        setSilent(false)
        write('\x1b')
        onRewindFailed?.()
        notifyRef.current?.("Le rembobinage n'a pas abouti : la conversation est restée telle quelle.", true)
      }, 9000)
    }
    // "Modifier": answer the CLI's questions ourselves — rewind to this message,
    // restore the conversation only — so it ends with the message back in the box.
    pendingRewind.current = {
      snippet: message.replace(/\s+/g, ' ').trim().slice(0, 24).toLowerCase(),
      nth: nth || 0,
      edit: !!edit,
      until: Date.now() + 12000,
    }
    // An agent still working has to stop before it will open its rewind list.
    if (working) {
      await write('\x1b')
      await new Promise((r) => setTimeout(r, 600))
    }
    rewind()
  }
  useEffect(() => {
    const p = pendingRewind.current
    if (!p || !dialog) return
    if (Date.now() > p.until) {
      pendingRewind.current = null
      return
    }
    // Second step of the CLI's rewind (the confirmation): pick "Restore
    // conversation" for a "modifier" request.
    if (p.edit && p.step2 && /confirm you want to restore/i.test(dialog.title || '')) {
      const i = dialog.options.findIndex((o) => /^(\d+\.\s*)?restore conversation$/i.test(o.trim()))
      if (i >= 0) {
        pendingRewind.current = null
        choose(i)
      }
      return
    }
    const hits = dialog.options.map((o, i) => [o.replace(/\s+/g, ' ').toLowerCase(), i]).filter(([o]) => o.includes(p.snippet))
    if (!hits.length) return
    pendingRewind.current = p.edit ? { ...p, step2: true, until: Date.now() + 8000 } : null
    choose(hits[Math.min(p.nth, hits.length - 1)][1])
  }, [dialog]) // eslint-disable-line react-hooks/exhaustive-deps
  const canSend = (text.trim() || files.length) && terminalId && !uploading


  const modeInfo = MODES[mode] || null

  return (
    <div
      className="relative border-t border-border bg-base font-mono"
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      {menuOpen && (
        <div className="absolute bottom-full left-0 right-0 z-30 max-h-72 overflow-y-auto border-y border-border-strong bg-surface py-1 shadow-2xl">
          {matches.map((item, i) => (
            <button
              key={`${item.scope}:${item.command}`}
              type="button"
              ref={(el) => i === menuIndex && el?.scrollIntoView({ block: 'nearest' })}
              onMouseEnter={() => setMenuIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pickCommand(item)
              }}
              className={`flex w-full cursor-pointer items-baseline gap-4 px-4 py-1 text-left text-[12.5px] ${
                i === menuIndex ? 'bg-surface-hover' : ''
              }`}
            >
              <span className={`w-48 shrink-0 truncate ${item.kind === 'builtin' ? 'text-text' : 'text-accent'}`}>{item.command}</span>
              <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-muted">{item.description}</span>
              <span className="shrink-0 font-sans text-[10.5px] uppercase tracking-wide text-muted/70">{SCOPE_LABEL[item.scope] || item.scope}</span>
            </button>
          ))}
        </div>
      )}

      {dialog && !silent && (
        // Floats over the terminal instead of pushing it: resizing the PTY
        // each time a question appears would make the CLI redraw.
        <div className="absolute inset-x-0 bottom-full z-20 max-h-[65vh] overflow-y-auto border-t border-border-strong bg-surface px-4 py-3 shadow-[0_-12px_24px_rgba(0,0,0,0.35)]">
          <div className="mb-2 flex items-center gap-2 font-sans text-[11px] font-medium uppercase tracking-wide text-warning">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            {dialog.kind === 'rewind' || /restore|rewind/i.test(dialog.title) ? 'Revenir en arrière' : `${agentLabel} attend ta réponse`}
          </div>
          {dialog.kind === 'rewind' && (
            <p className="mb-2 font-sans text-[12.5px] text-muted">Choisis le message à partir duquel repartir. Les messages les plus récents sont en bas.</p>
          )}
          {dialog.context.length > 0 && (
            <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-base px-3 py-2 text-[12px] leading-snug text-muted ring-1 ring-border">
              {dialog.context.map(fr).join('\n')}
            </pre>
          )}
          {dialog.title && dialog.kind !== 'rewind' && <p className="mb-2 font-sans text-[13.5px] font-medium text-text">{fr(dialog.title)}</p>}
          <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto">
            {dialog.options.map((label, i) => (
              <button
                key={i}
                type="button"
                onClick={() => choose(i)}
                className={`flex cursor-pointer items-baseline gap-3 rounded-lg px-3 py-1.5 text-left font-sans text-[13px] transition-colors ${
                  i === dialog.selected
                    ? 'bg-accent-bg text-text ring-1 ring-accent/50'
                    : 'text-muted hover:bg-surface-hover hover:text-text'
                }`}
              >
                <span className="w-4 shrink-0 text-right font-mono text-[11px] text-muted/70">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{fr(label.replace(/^\d+\.\s*/, ''))}</span>
                  {dialog.details?.[i] && <span className="block truncate text-[11.5px] text-muted/80">{fr(dialog.details[i])}</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3 font-sans text-[11.5px] text-muted">
            <span>Clique, ou ↑ ↓ + Entrée, ou un chiffre</span>
            <button type="button" onClick={() => write('\x1b')} className="ml-auto cursor-pointer rounded px-2 py-0.5 hover:bg-surface-hover hover:text-text">
              Annuler (Échap)
            </button>
          </div>
        </div>
      )}

      {undoable && (
        <div className="flex items-center gap-3 border-b border-border/60 bg-surface/50 px-4 py-1.5 font-sans text-[12px] text-muted">
          <span>Message rembobiné : la conversation repart d'avant lui.</span>
          <button type="button" onClick={onUndoRewind} className="cursor-pointer font-medium text-accent hover:underline">
            Annuler le rembobinage
          </button>
          <button
            type="button"
            onClick={onDismissUndo}
            title="Masquer"
            className="ml-auto cursor-pointer rounded px-1.5 text-muted/70 hover:bg-surface-hover hover:text-text"
          >
            ✕
          </button>
        </div>
      )}

      {(queue.length > 0 || inFlight) && (
        <div className="flex flex-col gap-1 border-b border-border/60 px-4 py-2 font-sans">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted">
            {queue.length > 0 ? `En attente · ${queue.length} — envoyé dès que ${agentLabel} a fini` : 'Envoi…'}
          </p>
          {inFlight && (
            <div className="flex items-start gap-2 rounded-md border border-dashed border-border-strong px-2.5 py-1.5 text-[12.5px] text-muted">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
              <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words">{inFlight.text || inFlight.message}</span>
              <span className="shrink-0 text-[11px]">envoi…</span>
            </div>
          )}
          {queue.map((q, i) => (
            <div key={q.id} className="flex items-start gap-2 rounded-md bg-surface px-2.5 py-1.5 text-[12.5px]">
              <span className="mt-px w-3 shrink-0 text-right text-[11px] tabular-nums text-muted">{i + 1}</span>
              <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words text-text">
                {q.text || 'Pièce jointe'}
                {q.files.length > 0 && <span className="ml-2 text-[11px] text-muted">📎 {q.files.length}</span>}
              </span>
              <button type="button" onClick={() => editQueued(q.id)} title="Remettre dans la zone de saisie pour le modifier" className="shrink-0 cursor-pointer rounded px-1.5 text-[11.5px] text-muted hover:bg-surface-hover hover:text-text">
                ↩ modifier
              </button>
              <button type="button" onClick={() => dropQueued(q.id)} title="Retirer de la file d'attente" className="shrink-0 cursor-pointer rounded px-1.5 text-muted hover:bg-surface-hover hover:text-danger">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-2.5">
          {files.map((f) => (
            <span key={f.path} className="group flex items-center gap-1.5 rounded border border-border-strong bg-surface py-0.5 pl-0.5 pr-1.5 text-[12px] text-text">
              {f.preview ? (
                <img src={f.preview} alt="" className="h-5 w-5 rounded-sm object-cover" />
              ) : (
                <IconClip className="ml-1 h-3.5 w-3.5 text-muted" />
              )}
              <span className="max-w-[160px] truncate">{f.name}</span>
              <button type="button" onClick={() => removeFile(f.path)} className="cursor-pointer text-muted hover:text-danger" title="Retirer">
                <IconX className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={`flex items-start gap-2.5 px-4 py-2.5 ${dragging ? 'bg-accent-bg' : ''}`}>
        <span className="select-none pt-px text-[14px] font-bold leading-[1.45] text-accent">❯</span>
        <textarea
          ref={textRef}
          value={text}
          rows={1}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setMenuDismissed(false)
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={`Écrire à ${agentLabel}…  (${kind === 'codex' ? '/ ou $' : '/'} commandes et skills · colle une image)`}
          className="block max-h-[40vh] min-w-0 flex-1 resize-none bg-transparent text-[13.5px] leading-[1.45] text-text outline-none placeholder:text-muted/50"
        />
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          title={busy ? `${agentLabel} travaille : le message part dès qu'il a fini (Entrée)` : 'Envoyer (Entrée)'}
          className="shrink-0 cursor-pointer rounded px-1.5 text-[12px] leading-[1.7] text-accent transition-opacity hover:bg-accent-bg disabled:cursor-default disabled:text-muted/40 disabled:hover:bg-transparent"
        >
          {busy ? '↵ mettre en file' : '↵ envoyer'}
        </button>
      </div>

      {/* Status line, like the CLI's own footer */}
      <div className="flex items-center gap-1 border-t border-border/60 px-3 py-1 text-[12px]">
        {kind === 'claude' && (
          <button
            type="button"
            onClick={() => write('\x1b[Z')}
            title={`${modeInfo?.hint || 'Mode inconnu pour le moment'} — cliquer pour changer de mode (Maj+Tab)`}
            className={`flex h-6 cursor-pointer items-center gap-1.5 rounded px-2 transition-colors hover:bg-surface-hover ${modeInfo?.tone || 'text-muted'}`}
          >
            <span className="text-[10px]">⏵⏵</span>
            {modeInfo ? modeInfo.label : 'Mode'}
          </button>
        )}
        <span className={`flex h-6 items-center gap-1.5 px-2 ${working ? 'text-accent' : 'text-muted/70'}`}>
          <span className={`h-1.5 w-1.5 rounded-full bg-current ${working ? 'animate-pulse' : ''}`} />
          {working ? 'en cours…' : 'prêt'}
        </span>
        <span className="ml-auto" />
        <FooterButton title="Joindre une image ou un fichier" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <IconClip className="h-3.5 w-3.5" /> joindre
        </FooterButton>
        <FooterButton title="Commandes et skills" onClick={openSlashMenu} active={menuOpen}>
          <IconSlash className="h-3.5 w-3.5" /> skills
        </FooterButton>
        {working && (
          <FooterButton title="Interrompre l'agent (Échap)" onClick={() => write('\x1b')} danger>
            <IconStop className="h-3 w-3" /> stop
          </FooterButton>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.md,.json,.csv,.log"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

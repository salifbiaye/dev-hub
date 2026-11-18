import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Marked } from 'marked'

// The conversation of a Claude / Codex session, drawn by us from the
// transcript the CLI writes on disk — a terminal's look (monospace, ❯ and ●
// markers, ⎿ for results) without being a terminal, so there is no CLI prompt
// to hide and scrolling back never reveals one.

function api() {
  return window.pywebview?.api
}

// Transcripts already attached to a pane, so two new sessions in the same repo
// don't latch onto the same file.
const claimed = new Set()

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Model output is untrusted text: raw HTML is shown as text and links never
// navigate the app (a click would otherwise load the page inside the window).
const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => esc(text),
    image: ({ text }) => esc(text || ''),
    link(token) {
      return `<span class="ai-md-link" title="${esc(token.href)}">${this.parser.parseInline(token.tokens)}</span>`
    },
  },
})

function Markdown({ text }) {
  const html = useMemo(() => {
    try {
      return md.parse(text)
    } catch {
      return esc(text)
    }
  }, [text])
  return <div className="ai-md min-w-0 flex-1 break-words" dangerouslySetInnerHTML={{ __html: html }} />
}

const short = (path, root) => {
  if (!path) return ''
  const p = String(path)
  const r = String(root || '')
  if (r && p.toLowerCase().startsWith(r.toLowerCase())) return p.slice(r.length).replace(/^[\\/]+/, '') || '.'
  return p
}

const ARG_KEYS = {
  Bash: 'command',
  shell: 'command',
  Read: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'pattern',
  Glob: 'pattern',
  Task: 'description',
  Agent: 'description',
  WebFetch: 'url',
  WebSearch: 'query',
}

function toolSummary(tool, root) {
  const input = tool.input || {}
  const key = ARG_KEYS[tool.name]
  let value = key ? input[key] : undefined
  if (value === undefined) {
    const first = Object.values(input).find((v) => typeof v === 'string')
    value = first
  }
  if (Array.isArray(value)) value = value.join(' ')
  if (key && /path/.test(key)) value = short(value, root)
  return String(value ?? '').replace(/\s+/g, ' ').slice(0, 160)
}

function Collapsible({ text, lines = 5, tone = '' }) {
  const [open, setOpen] = useState(false)
  const all = String(text || '').replace(/\s+$/, '').split('\n')
  const shown = open ? all : all.slice(0, lines)
  const hidden = all.length - shown.length
  return (
    <div className={`min-w-0 flex-1 ${tone}`}>
      <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.5]">{shown.join('\n')}</pre>
      {(hidden > 0 || open) && all.length > lines && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 cursor-pointer text-[11.5px] text-muted/80 hover:text-text"
        >
          {open ? 'Réduire' : `… +${hidden} ligne${hidden > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  )
}

const DIFF_LINES = 8

function DiffView({ oldText, newText }) {
  const [open, setOpen] = useState(false)
  const removed = String(oldText || '').split('\n')
  const added = String(newText || '').split('\n')
  const cap = open ? 200 : DIFF_LINES
  const hidden = Math.max(0, removed.length - cap) + Math.max(0, added.length - cap)
  const rows = [
    ...removed.slice(0, cap).map((l) => ['-', l]),
    ...added.slice(0, cap).map((l) => ['+', l]),
  ]
  return (
    <div className="min-w-0 flex-1">
      <pre className="m-0 overflow-x-auto font-mono text-[12px] leading-[1.5]">
        {rows.map(([sign, line], i) => (
          <div key={i} className={`flex gap-2 px-2 ${sign === '-' ? 'bg-danger/10' : 'bg-success/10'}`}>
            <span className={`select-none ${sign === '-' ? 'text-danger' : 'text-success'}`}>{sign}</span>
            <span className="text-text/90">{line || ' '}</span>
          </div>
        ))}
      </pre>
      {(hidden > 0 || open) && (removed.length > DIFF_LINES || added.length > DIFF_LINES) && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-0.5 cursor-pointer text-[11.5px] text-muted/80 hover:text-text">
          {open ? 'Réduire' : `… +${hidden} ligne${hidden > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  )
}

function ToolBlock({ tool, result, root, running }) {
  const input = tool.input || {}
  const failed = result?.is_error
  const dot = failed ? 'text-danger' : result ? 'text-success' : running ? 'animate-pulse text-accent' : 'text-muted'
  let body = null
  if (tool.name === 'Edit' && input.old_string !== undefined) {
    body = <DiffView oldText={input.old_string} newText={input.new_string} />
  } else if (tool.name === 'MultiEdit' && Array.isArray(input.edits)) {
    body = <DiffView oldText={input.edits.map((e) => e.old_string).join('\n…\n')} newText={input.edits.map((e) => e.new_string).join('\n…\n')} />
  } else if (tool.name === 'Write') {
    body = <span className="text-[12px] text-muted">{String(input.content || '').split('\n').length} lignes écrites</span>
  } else if (tool.name === 'TodoWrite' && Array.isArray(input.todos)) {
    body = (
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12.5px]">
        {input.todos.map((t, i) => (
          <div key={i} className={t.status === 'completed' ? 'text-muted line-through' : t.status === 'in_progress' ? 'text-text' : 'text-muted'}>
            {t.status === 'completed' ? '☒' : '☐'} {t.content}
          </div>
        ))}
      </div>
    )
  } else if (tool.name === 'Read' && result && !failed) {
    body = <span className="text-[12px] text-muted">Lu {String(result.text || '').split('\n').length} lignes</span>
  } else if (result) {
    body = <Collapsible text={result.text} tone={failed ? 'text-danger' : 'text-muted'} />
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className={dot}>●</span>
        <span className="min-w-0 truncate">
          <span className="font-semibold text-text">{tool.name}</span>
          <span className="text-muted">({toolSummary(tool, root)})</span>
        </span>
      </div>
      {body && (
        <div className="flex items-start gap-2 pl-[1.35rem] text-muted">
          <span className="select-none leading-[1.5]">⎿</span>
          {body}
        </div>
      )}
    </div>
  )
}

function Thinking({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1 text-muted">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex cursor-pointer items-baseline gap-3 text-left italic hover:text-text">
        <span>✻</span>
        Réflexion {open ? '' : '…'}
      </button>
      {open && <pre className="m-0 whitespace-pre-wrap break-words pl-[1.35rem] font-mono text-[12px] leading-[1.5]">{text}</pre>}
    </div>
  )
}

const IconUndo = ({ className = 'h-3.5 w-3.5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </svg>
)
const IconCopyMini = ({ className = 'h-3.5 w-3.5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
)
const IconTick = ({ className = 'h-3.5 w-3.5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m5 12 5 5 9-10" />
  </svg>
)

function ago(iso) {
  const t = Date.parse(iso || '')
  if (!t) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return "à l'instant"
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  return `il y a ${Math.floor(s / 86400)} j`
}

// One message you wrote. On hover, a small pill on its lower edge — like in
// Claude Desktop: how long ago, copy, and "Rembobiner jusqu'ici", which takes
// the message and everything after it out of the conversation and hands the
// text back to the box below to be corrected.
function UserBubble({ e, nth, onRewind, onCopy }) {
  const [copied, setCopied] = useState(false)
  const [up, setUp] = useState(true) // tooltip above the pill, unless the message is at the very top
  async function copy() {
    const r = await onCopy?.(e.text)
    if (r === undefined || r?.ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1300)
    }
  }
  return (
    <div
      className="group relative flex gap-3 rounded-md bg-surface px-3 py-2"
      onMouseEnter={(ev) => {
        const scroller = ev.currentTarget.closest('.theme-scroll')
        const top = ev.currentTarget.getBoundingClientRect().top - (scroller ? scroller.getBoundingClientRect().top : 0)
        setUp(top > 110)
      }}
    >
      <span className="select-none font-bold text-accent">❯</span>
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-text">{e.text}</div>
      <div className="absolute -bottom-3 right-3 z-10 hidden items-center gap-0.5 rounded-lg border border-border-strong bg-base px-1.5 py-0.5 font-sans text-[11.5px] text-muted shadow-md group-hover:flex">
        {e.ts && <span className="px-1">{ago(e.ts)}</span>}
        <button
          type="button"
          onClick={copy}
          title={copied ? 'Copié' : 'Copier le message'}
          className="cursor-pointer rounded p-1 transition-colors hover:bg-surface-hover hover:text-text"
        >
          {copied ? <IconTick className="h-3.5 w-3.5 text-success" /> : <IconCopyMini />}
        </button>
        {onRewind && (
          <span className="group/tip relative">
            <button
              type="button"
              onClick={() => onRewind(e.text, nth, e.id, true)}
              className="cursor-pointer rounded p-1 transition-colors hover:bg-surface-hover hover:text-text"
            >
              <IconUndo />
            </button>
            <span className={`pointer-events-none absolute right-0 z-20 hidden w-60 ${up ? 'bottom-full mb-2' : 'top-full mt-2'} rounded-lg border border-border-strong bg-surface p-2.5 text-left shadow-xl group-hover/tip:block`}>
              <span className="block text-[12.5px] font-semibold text-text">Rembobiner jusqu'ici</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">Retire ce message et tout ce qui le suit de la conversation.</span>
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

const LIMIT = 300

// What the rewind list of the CLI shows of a message: the start of it.
const snippetOf = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 24).toLowerCase()

export default function AiConversation({ repo, provider, session, startedAt, working, agentLabel, Logo, onRewind, onCopy, onSession, controlRef, onUnsupported }) {
  const [events, setEvents] = useState([])
  // After "Restore conversation" the CLI forgets that message and everything
  // after it — until its next message the transcript on disk still has them,
  // so the view cuts them itself.
  useEffect(() => {
    if (!controlRef) return undefined
    controlRef.current = {
      // Read the transcript again from scratch (a rewind that didn't go through).
      reload: () => {
        fileRef.current = null
        offsetRef.current = 0
        initialRef.current = { done: false, events: [] }
        linksRef.current = { map: new Map(), last: null }
        setEvents([])
      },
      truncateAt: (id) => {
        if (!id) return
        setEvents((prev) => {
          const i = prev.findIndex((e) => e.id === id)
          return i < 0 ? prev : prev.slice(0, i)
        })
      },
    }
    return () => {
      controlRef.current = null
    }
  }, [controlRef])
  const [loaded, setLoaded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [stuck, setStuck] = useState(true)
  const scrollRef = useRef(null)
  const stuckRef = useRef(true)
  const offsetRef = useRef(0)
  const initialRef = useRef({ done: false, events: [] }) // first read of the file, shown in one go
  const linksRef = useRef({ map: new Map(), last: null }) // uuid -> parent uuid, last line written
  const [linksRev, setLinksRev] = useState(0)
  const fileRef = useRef(null)
  const sessionRef = useRef(session || null)
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession
  const unsupportedRef = useRef(onUnsupported)
  unsupportedRef.current = onUnsupported

  useEffect(() => {
    if (session) claimed.add(session)
    sessionRef.current = session || null
  }, [session])

  useEffect(() => {
    let alive = true
    let timer = null
    async function tick() {
      let delay = 900
      try {
        const r = await api()?.ai_transcript_poll?.(
          repo.path,
          provider || null,
          sessionRef.current,
          startedAt,
          offsetRef.current,
          [...claimed].filter((id) => id !== sessionRef.current),
          fileRef.current,
        )
        if (!alive) return
        if (r && r.supported === false) {
          unsupportedRef.current?.()
          return
        }
        if (r) {
          if (r.file_key) {
            fileRef.current = r.file_key
            offsetRef.current = r.offset
          }
          if (r.session_id && !sessionRef.current) {
            sessionRef.current = r.session_id
            claimed.add(r.session_id)
          }
          if (r.session_id) onSessionRef.current?.(r.session_id)
          if (r.reset) {
            linksRef.current = { map: new Map(), last: null }
            initialRef.current = { done: false, events: [] }
            setEvents([])
          }
          if (r.links?.length) {
            for (const [uuid, parent] of r.links) linksRef.current.map.set(uuid, parent)
            linksRef.current.last = r.links[r.links.length - 1][0]
          }
          const initial = initialRef.current
          if (r.file_key && !initial.done) {
            // First read of a session: it arrives in chunks, and until the last
            // line is known the live branch can't be told from the abandoned
            // ones — drawing now would flash old messages. Show everything at once.
            for (const e of r.events || []) initial.events.push(e)
            if (!r.more) {
              initial.done = true
              const all = initial.events
              initial.events = []
              setEvents(all)
              setLinksRev((v) => v + 1)
              setLoaded(true)
            }
          } else {
            if (r.links?.length) setLinksRev((v) => v + 1)
            if (r.events?.length) setEvents((prev) => prev.concat(r.events))
            if (r.file_key) setLoaded(true)
          }
          if (r.more) delay = 30
        }
      } catch {
        delay = 1800
      }
      if (alive) timer = setTimeout(tick, delay)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [repo.path, provider, startedAt])

  // Pair every result with its tool call, and drop the standalone results.
  const items = useMemo(() => {
    // The transcript keeps every branch. After a rewind, the abandoned
    // messages stay in the file and the new ones hang off an earlier message:
    // follow the parent links from the last line to find the live branch and
    // hide what forked away from it. History that isn't linked to it (before a
    // compaction, an older file) is left as is, and results of tools that ran in
    // parallel (their own little branches) stay with their call.
    const { map, last } = linksRef.current
    let keep = () => true
    if (map.size && last) {
      const chain = new Set()
      for (let u = last; u && map.has(u) && !chain.has(u); u = map.get(u)) chain.add(u)
      const kindOf = new Map()
      for (const e of events) if (e.uuid && !kindOf.has(e.uuid)) kindOf.set(e.uuid, e.kind)
      // Where a branch starts: its topmost line below the live chain (or its
      // root, when it hangs off nothing — rewinding to the first message starts
      // an unrelated root). A branch that starts with a message *you wrote* is an
      // abandoned try; one that starts with the agent's own line is a sibling of
      // the live one (parallel tool calls and their results) and stays.
      const headCache = new Map()
      const headOf = (id) => {
        const path = []
        let x = id
        let head
        for (;;) {
          if (headCache.has(x)) {
            head = headCache.get(x)
            break
          }
          path.push(x)
          const parent = map.get(x)
          if (!parent || !map.has(parent) || chain.has(parent)) {
            head = x
            break
          }
          x = parent
        }
        for (const n of path) headCache.set(n, head)
        return head
      }
      keep = (e) => !e.uuid || chain.has(e.uuid) || kindOf.get(headOf(e.uuid)) !== 'user'
    }
    const shown = events.filter(keep)
    const results = new Map()
    for (const e of shown) if (e.kind === 'result' && e.tool_id) results.set(e.tool_id, e)
    return shown.filter((e) => e.kind !== 'result').map((e) => (e.kind === 'tool' ? { ...e, result: results.get(e.tool_id) } : e))
  }, [events, linksRev])
  const visible = showAll ? items : items.slice(-LIMIT)
  // The n-th message starting with the same words, to pick the right line when
  // the CLI's rewind list has several alike ("oui", "ok"…).
  const nthOf = useMemo(() => {
    const seen = new Map()
    const out = new Map()
    for (const e of items) {
      if (e.kind !== 'user') continue
      const s = snippetOf(e.text)
      const n = seen.get(s) || 0
      out.set(e.id, n)
      seen.set(s, n + 1)
    }
    return out
  }, [items])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stuckRef.current = near
    setStuck(near)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stuckRef.current) el.scrollTop = el.scrollHeight
  }, [events, working])

  function toBottom() {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className="relative min-h-0 flex-1 bg-base">
      <div ref={scrollRef} onScroll={onScroll} className="theme-scroll absolute inset-0 overflow-y-auto px-5 py-4 font-mono text-[13px] leading-[1.55]">
        <div className="flex w-full flex-col gap-3.5">
          {items.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-center font-sans text-muted">
              {Logo && <Logo className="h-9 w-9 opacity-80" />}
              <p className="text-[14px] text-text">{loaded || !session ? `Nouvelle conversation avec ${agentLabel}` : 'Chargement de la conversation…'}</p>
              <p className="text-[12.5px]">Écris ton message dans la barre en bas.</p>
            </div>
          )}
          {!showAll && items.length > LIMIT && (
            <button type="button" onClick={() => setShowAll(true)} className="cursor-pointer self-center font-sans text-[12px] text-muted hover:text-text">
              Afficher les {items.length - LIMIT} messages plus anciens
            </button>
          )}
          {visible.map((e) => {
            if (e.kind === 'user') {
              return <UserBubble key={e.id} e={e} nth={nthOf.get(e.id) || 0} onRewind={onRewind} onCopy={onCopy} />
            }
            if (e.kind === 'command') {
              return (
                <div key={e.id} className="flex gap-3 rounded-md bg-surface px-3 py-2">
                  <span className="select-none font-bold text-accent">❯</span>
                  <div className="min-w-0 flex-1 break-words text-accent">{e.text}</div>
                </div>
              )
            }
            if (e.kind === 'assistant') {
              return (
                <div key={e.id} className="flex gap-3 text-text">
                  <span className="select-none">●</span>
                  <Markdown text={e.text} />
                </div>
              )
            }
            if (e.kind === 'thinking') return <Thinking key={e.id} text={e.text} />
            if (e.kind === 'tool') return <ToolBlock key={e.id} tool={e} result={e.result} root={repo.path} running={working && !e.result} />
            if (e.kind === 'system') {
              return (
                <div key={e.id} className="pl-[1.35rem] text-[12px] text-muted">
                  {e.text}
                </div>
              )
            }
            return null
          })}
          {working && (
            <div className="flex items-baseline gap-3 text-accent">
              <span className="animate-pulse">✻</span>
              <span className="text-[12.5px]">{agentLabel} travaille…</span>
            </div>
          )}
        </div>
      </div>
      {!stuck && (
        <button
          type="button"
          onClick={toBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 cursor-pointer rounded-full border border-border-strong bg-surface px-3 py-1 font-sans text-[12px] text-muted shadow-lg hover:text-text"
        >
          ↓ Revenir en bas
        </button>
      )}
    </div>
  )
}

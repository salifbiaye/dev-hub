import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'

function api() {
  return window.pywebview?.api
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Files the Code tab can render (Aperçu) besides showing their source.
export function previewKindForFile(file) {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'md'
  if (ext === 'html' || ext === 'htm') return 'html'
  return null
}

// Unsaved edits, kept outside the component: the Code tab re-mounts the
// viewer on every refresh, which must not throw away what was being typed.
const drafts = new Map()
// window.__devhub_dirty tells core/page_watchdog.py not to reload the page
// (which would lose these edits).
const markDirty = () => {
  window.__devhub_dirty = drafts.size > 0
}
export const draftStore = {
  get: (key) => drafts.get(key),
  set: (key, value) => {
    drafts.set(key, value)
    markDirty()
  },
  clear: (key) => {
    drafts.delete(key)
    markDirty()
  },
}

/**
 * Plain textarea layered over a Prism-highlighted <pre>: the textarea's own
 * text is transparent, so you type into a real textarea (native caret,
 * selection, undo) while seeing the colored code underneath. Both layers
 * share the exact same font metrics and padding; the pre follows the
 * textarea's scroll.
 */
export function CodeEditor({ value, onChange, onSave, highlight }) {
  const taRef = useRef(null)
  const preRef = useRef(null)
  const gutterRef = useRef(null)

  const lineCount = useMemo(() => value.split('\n').length, [value])
  const html = useMemo(
    () =>
      value
        .split('\n')
        .map((line) => highlight(line) ?? escapeHtml(line))
        .join('\n') + '\n',
    [value, highlight],
  )

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  function syncScroll() {
    const ta = taRef.current
    if (!ta) return
    if (preRef.current) preRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      onSave()
      return
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      // execCommand keeps the edit on the textarea's native undo stack.
      document.execCommand('insertText', false, '  ')
    }
  }

  const metrics = 'font-mono text-[12px] leading-[20px] whitespace-pre px-3 py-2'
  return (
    <div className="flex flex-1 overflow-hidden bg-base">
      <div className="w-12 shrink-0 overflow-hidden border-r border-border bg-surface select-none">
        <div ref={gutterRef} className="py-2 pr-2 text-right font-mono text-[11px] leading-[20px] text-muted/50">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <pre
          ref={preRef}
          aria-hidden
          className={`pointer-events-none absolute top-0 left-0 m-0 min-w-full text-text ${metrics}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          className={`theme-scroll absolute inset-0 h-full w-full resize-none overflow-auto border-none bg-transparent text-transparent caret-[var(--color-text)] outline-none selection:bg-accent/30 ${metrics}`}
        />
      </div>
    </div>
  )
}

function themeColors() {
  const css = getComputedStyle(document.documentElement)
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback
  return {
    base: v('--color-base', '#0a0a0c'),
    surface: v('--color-surface', '#111114'),
    border: v('--color-border', '#232327'),
    text: v('--color-text', '#ededf0'),
    muted: v('--color-muted', '#8b8b93'),
    accent: v('--color-accent', '#6e56cf'),
  }
}

function markdownDocument(body) {
  const c = themeColors()
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    body{margin:0;padding:28px 36px;background:${c.base};color:${c.text};font:14px/1.7 'Segoe UI',system-ui,sans-serif;max-width:860px}
    h1,h2,h3,h4{line-height:1.25;margin:1.6em 0 .6em;font-weight:600}
    h1{font-size:1.9em;padding-bottom:.3em;border-bottom:1px solid ${c.border}}
    h2{font-size:1.45em;padding-bottom:.25em;border-bottom:1px solid ${c.border}}
    h1:first-child,h2:first-child{margin-top:0}
    a{color:${c.accent};text-decoration:none} a:hover{text-decoration:underline}
    p,ul,ol,blockquote,table,pre{margin:0 0 1em}
    code{font:12.5px Consolas,'Cascadia Code',monospace;background:${c.surface};border:1px solid ${c.border};border-radius:4px;padding:.1em .35em}
    pre{background:${c.surface};border:1px solid ${c.border};border-radius:8px;padding:14px 16px;overflow:auto}
    pre code{background:none;border:none;padding:0}
    blockquote{margin-left:0;padding:.2em 1em;color:${c.muted};border-left:3px solid ${c.accent}}
    table{border-collapse:collapse} th,td{border:1px solid ${c.border};padding:6px 12px} th{background:${c.surface}}
    img{max-width:100%;border-radius:6px} hr{border:none;border-top:1px solid ${c.border};margin:2em 0}
    input[type=checkbox]{accent-color:${c.accent};margin-right:.4em}
    li:has(> input[type=checkbox]){list-style:none;margin-left:-1.3em}
  </style></head><body>${body}</body></html>`
}

function dirOf(file) {
  const i = file.lastIndexOf('/')
  return i === -1 ? '' : file.slice(0, i + 1)
}

function resolveRepoPath(fromFile, src) {
  const parts = (dirOf(fromFile) + src).split('/')
  const out = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

// Relative <img> sources point inside the repo, which the sandboxed iframe
// can't reach: inline them through the same bridge the image viewer uses.
async function inlineRepoImages(htmlText, repoPath, file) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html')
  const imgs = [...doc.querySelectorAll('img[src]')].filter((img) => {
    const src = img.getAttribute('src')
    return src && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)
  })
  await Promise.all(
    imgs.slice(0, 40).map(async (img) => {
      const target = resolveRepoPath(file, decodeURIComponent(img.getAttribute('src').split(/[?#]/)[0]))
      const r = await api()?.read_file_content(repoPath, target)
      if (r?.dataUrl) img.setAttribute('src', r.dataUrl)
    }),
  )
  return '<!doctype html>' + doc.documentElement.outerHTML
}

/**
 * Rendered Markdown / HTML in a sandboxed iframe (no allow-same-origin): the
 * page can't reach Dev Hub's window.pywebview bridge, whatever it contains.
 * HTML keeps its scripts; Markdown gets none.
 */
export function FilePreview({ kind, source, repoPath, file }) {
  const [doc, setDoc] = useState(null)

  useEffect(() => {
    let alive = true
    const raw = kind === 'md' ? markdownDocument(marked.parse(source, { gfm: true })) : source
    inlineRepoImages(raw, repoPath, file)
      .catch(() => raw)
      .then((d) => alive && setDoc(d))
    return () => {
      alive = false
    }
  }, [kind, source, repoPath, file])

  if (doc === null) return <p className="p-3 text-xs text-muted">Rendu…</p>
  return (
    <iframe
      title={`Aperçu de ${file}`}
      srcDoc={doc}
      sandbox={kind === 'html' ? 'allow-scripts' : ''}
      className={`flex-1 border-none ${kind === 'html' ? 'bg-white' : 'bg-base'}`}
    />
  )
}

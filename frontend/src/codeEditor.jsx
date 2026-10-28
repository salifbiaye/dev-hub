import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
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
  keys: () => [...drafts.keys()],
}

/**
 * Plain textarea layered over a Prism-highlighted <pre>: the textarea's own
 * text is transparent, so you type into a real textarea (native caret,
 * selection, undo) while seeing the colored code underneath. Both layers
 * share the exact same font metrics and padding; the pre follows the
 * textarea's scroll.
 */
// Wraps every occurrence of `term` in <mark>; the one on `activeLine` (first
// occurrence) gets the stronger style. Same text as the textarea, so the
// marks sit exactly under the matching words.
function findMarks(value, term, activeLine) {
  const lower = term.toLowerCase()
  return (
    value
      .split('\n')
      .map((line, i) => {
        const low = line.toLowerCase()
        let at = low.indexOf(lower)
        if (at === -1) return escapeHtml(line)
        let out = ''
        let from = 0
        let first = true
        while (at !== -1) {
          out += escapeHtml(line.slice(from, at))
          const cls = i === activeLine && first ? 'code-find-mark cur' : 'code-find-mark'
          out += `<mark class="${cls}">${escapeHtml(line.slice(at, at + lower.length))}</mark>`
          from = at + lower.length
          first = false
          at = low.indexOf(lower, from)
        }
        return out + escapeHtml(line.slice(from))
      })
      .join('\n') + '\n'
  )
}

const LANGUAGE_WORDS = {
  javascript: ['import', 'export', 'from', 'const', 'let', 'function', 'return', 'async', 'await', 'class', 'extends', 'if', 'else', 'for', 'while', 'new', 'try', 'catch'],
  jsx: ['import', 'export', 'from', 'const', 'function', 'return', 'useState', 'useEffect', 'useMemo', 'useCallback', 'props', 'className'],
  typescript: ['import', 'export', 'from', 'const', 'let', 'interface', 'type', 'function', 'return', 'async', 'await', 'class', 'public', 'private'],
  tsx: ['import', 'export', 'from', 'const', 'interface', 'type', 'function', 'return', 'useState', 'useEffect', 'className'],
  python: ['import', 'from', 'as', 'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'with', 'async', 'await', 'True', 'False', 'None'],
  java: ['package', 'import', 'public', 'private', 'class', 'interface', 'extends', 'implements', 'static', 'void', 'return', 'new', 'if', 'else'],
  css: ['display', 'position', 'color', 'background', 'margin', 'padding', 'width', 'height', 'flex', 'grid', 'border', 'font-size'],
  html: ['div', 'span', 'button', 'input', 'section', 'main', 'header', 'class', 'id', 'href', 'src'],
  sql: ['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'TABLE', 'ORDER', 'GROUP', 'LIMIT'],
}

function wordBefore(value, cursor) {
  return (value.slice(0, cursor).match(/[A-Za-z_$][\w$]*$/) || [''])[0]
}

function indentWidth(language) {
  return language === 'python' ? '    ' : '  '
}

function relativeImport(fromFile, target) {
  const from = fromFile.split('/').slice(0, -1)
  const to = target.split('/')
  while (from.length && to.length && from[0] === to[0]) {
    from.shift()
    to.shift()
  }
  return `${from.length ? '../'.repeat(from.length) : './'}${to.join('/')}`
}

function completionItems(value, cursor, language, file, projectFiles) {
  const before = value.slice(0, cursor)
  const line = before.slice(before.lastIndexOf('\n') + 1)
  const imported = line.match(/(?:from\s*|import\s*)['"]([^'"]*)$/)
  if (imported) {
    const typed = imported[1].toLowerCase()
    const entries = projectFiles
      .filter((p) => p !== file && /\.(?:[cm]?[jt]sx?|py|java|css|scss|json)$/i.test(p))
      .map((p) => relativeImport(file, p))
      .filter((p) => p.toLowerCase().includes(typed))
      .slice(0, 12)
    return { from: cursor - imported[1].length, items: [...new Set(entries)] }
  }
  const word = wordBefore(value, cursor)
  if (!word) return { from: cursor, items: [] }
  const symbols = [...value.matchAll(/\b(?:function|class|const|let|def|interface|type)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  const choices = [...new Set([...(LANGUAGE_WORDS[language] || []), ...symbols])]
    .filter((item) => item.toLowerCase().startsWith(word.toLowerCase()) && item !== word)
    .slice(0, 10)
  return { from: cursor - word.length, items: choices }
}

// Where an import specifier points inside the project: relative paths, and
// the usual root aliases (@/, ~/, #/ → src/ or the repo root). Packages
// (react, expo-router…) resolve to nothing.
function resolveSpecifier(raw, file, projectFiles) {
  const matches = (p, candidate) =>
    p === candidate || p.replace(/\.[^.]+$/, '') === candidate || p.startsWith(`${candidate}/index.`)
  if (raw.startsWith('.')) {
    const base = file.split('/').slice(0, -1)
    for (const part of raw.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') base.pop()
      else base.push(part)
    }
    const candidate = base.join('/')
    return projectFiles.find((p) => matches(p, candidate)) || null
  }
  const alias = raw.match(/^[@~#]\/(.+)$/)
  if (!alias) return null
  const rest = alias[1]
  // A monorepo's app lives in a subfolder (portfolio/src/…): the alias is
  // relative to the package root, taken from the current file's own src/.
  const at = `/${file}`.indexOf('/src/')
  const root = at > 0 ? file.slice(0, at - 1) + '/' : ''
  return (
    projectFiles.find((p) => matches(p, `${root}src/${rest}`)) ||
    projectFiles.find((p) => matches(p, `${root}${rest}`)) ||
    projectFiles.find((p) => matches(p, `src/${rest}`)) ||
    projectFiles.find((p) => matches(p, rest)) ||
    projectFiles.find((p) => /(?:^|\/)src\//.test(p) && matches(p.slice(p.indexOf('src/')), `src/${rest}`)) ||
    null
  )
}

// name → import specifier, for every binding the file imports.
function importBindings(source) {
  const map = new Map()
  for (const m of source.matchAll(/import\s+([^'";]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = m[1].replace(/^type\s+/, '')
    const named = clause.match(/\{([^}]*)\}/)
    if (named) {
      for (const item of named[1].split(',')) {
        const name = item.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim()
        if (name) map.set(name, m[2])
      }
    }
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/\*\s+as\s+/, '')
    for (const name of rest.split(',').map((t) => t.trim()).filter(Boolean)) map.set(name, m[2])
  }
  for (const m of source.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) map.set(m[1], m[2])
  for (const m of source.matchAll(/^\s*from\s+(\.+[\w.]*)\s+import\s+([\w, ]+)/gm)) {
    const dots = m[1].match(/^\.+/)[0].length
    const mod = m[1].slice(dots).replace(/\./g, '/')
    const spec = `${dots === 1 ? './' : '../'.repeat(dots - 1)}${mod}`
    for (const name of m[2].split(',').map((t) => t.trim().split(/\s+as\s+/).pop()).filter(Boolean)) map.set(name, spec)
  }
  return map
}

function wordAt(value, cursor) {
  const before = (value.slice(0, cursor).match(/[A-Za-z_$][\w$]*$/) || [''])[0]
  const after = (value.slice(cursor).match(/^[\w$]*/) || [''])[0]
  return before + after
}

// `source` is the whole file (the click handler may only hand us one line).
export function referenceTarget(value, cursor, file, projectFiles, source = value) {
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1
  const lineEnd = value.indexOf('\n', cursor)
  const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd)
  const quote = [...line.matchAll(/['"]([^'"]+)['"]/g)].find((m) => {
    const at = m.index
    return cursor - lineStart >= at && cursor - lineStart <= at + m[0].length
  })
  if (quote) return resolveSpecifier(quote[1], file, projectFiles) || undefined
  const token = wordAt(value, cursor)
  if (!token) return null
  const spec = importBindings(source).get(token)
  if (spec) {
    const resolved = resolveSpecifier(spec, file, projectFiles)
    if (resolved) return resolved
  }
  const lower = token.toLowerCase()
  return projectFiles.find((p) => p.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase() === lower)
    || projectFiles.find((p) => p.toLowerCase().includes(`/${lower}.`))
}

export function CodeEditor({ value, onChange, onSave, highlight, language, file, projectFiles = [], onOpenFile, onNotify, findTerm = '', findLine = -1, ref }) {
  const taRef = useRef(null)
  const markRef = useRef(null)
  const preRef = useRef(null)
  const gutterRef = useRef(null)
  const [completion, setCompletion] = useState({ from: 0, items: [], active: 0, left: 12, top: 28 })

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

  const marks = useMemo(() => (findTerm ? findMarks(value, findTerm, findLine) : null), [value, findTerm, findLine])

  // Scroll a search match into view (line height 20 px, ~7.2 px per column).
  useImperativeHandle(ref, () => ({
    reveal(line, col) {
      const ta = taRef.current
      if (!ta) return
      ta.scrollTop = Math.max(0, line * 20 - ta.clientHeight / 2)
      const x = col * 7.2
      if (x < ta.scrollLeft || x > ta.scrollLeft + ta.clientWidth - 60) ta.scrollLeft = Math.max(0, x - 80)
    },
  }))

  function syncScroll() {
    const ta = taRef.current
    if (!ta) return
    const t = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`
    if (preRef.current) preRef.current.style.transform = t
    if (markRef.current) markRef.current.style.transform = t
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`
  }

  function refreshCompletion(text, cursor) {
    const next = completionItems(text, cursor, language, file, projectFiles)
    const ta = taRef.current
    // The textarea and the syntax layer deliberately share fixed monospace
    // metrics (7.2 px per character, 20 px per line). This gives us a stable
    // caret anchor without a second hidden editor or a heavyweight IDE.
    const before = text.slice(0, cursor)
    const lineStart = before.lastIndexOf('\n') + 1
    const line = before.split('\n').length - 1
    const column = before.length - lineStart
    const wantedLeft = 12 + column * 7.2 - (ta?.scrollLeft || 0)
    const wantedTop = 8 + (line + 1) * 20 - (ta?.scrollTop || 0)
    const left = Math.max(8, Math.min((ta?.clientWidth || 320) - 296, wantedLeft))
    const top = Math.max(4, Math.min((ta?.clientHeight || 200) - 180, wantedTop))
    setCompletion({ ...next, active: 0, left, top })
  }

  function acceptCompletion(index = completion.active) {
    const ta = taRef.current
    const item = completion.items[index]
    if (!ta || !item) return false
    const next = value.slice(0, completion.from) + item + value.slice(ta.selectionEnd)
    const caret = completion.from + item.length
    onChange(next)
    requestAnimationFrame(() => ta.setSelectionRange(caret, caret))
    setCompletion({ from: caret, items: [], active: 0, left: completion.left, top: completion.top })
    return true
  }

  function openReference() {
    const ta = taRef.current
    if (!ta) return
    const target = referenceTarget(value, ta.selectionStart, file, projectFiles)
    if (target) onOpenFile?.(target)
    else onNotify?.('Référence locale introuvable')
  }

  function indentSelection(outdent = false) {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const first = value.lastIndexOf('\n', start - 1) + 1
    const last = value.indexOf('\n', end)
    const until = last === -1 ? value.length : last
    const block = value.slice(first, until)
    const unit = indentWidth(language)
    const updated = block.split('\n').map((line) => outdent ? line.replace(new RegExp(`^(?:${unit}|\\t)`), '') : unit + line).join('\n')
    onChange(value.slice(0, first) + updated + value.slice(until))
    const delta = updated.length - block.length
    requestAnimationFrame(() => ta.setSelectionRange(start + (outdent ? Math.min(0, delta) : unit.length), end + delta))
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      onSave()
      return
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      if (completion.items.length && !e.shiftKey && acceptCompletion()) return
      if (e.shiftKey || taRef.current?.selectionStart !== taRef.current?.selectionEnd) {
        indentSelection(e.shiftKey)
        return
      }
      // execCommand keeps the edit on the textarea's native undo stack.
      document.execCommand('insertText', false, indentWidth(language))
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
      e.preventDefault()
      refreshCompletion(value, taRef.current?.selectionStart ?? 0)
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      openReference()
      return
    }
    if (completion.items.length && e.key === 'ArrowDown') {
      e.preventDefault()
      setCompletion((c) => ({ ...c, active: (c.active + 1) % c.items.length }))
      return
    }
    if (completion.items.length && e.key === 'ArrowUp') {
      e.preventDefault()
      setCompletion((c) => ({ ...c, active: (c.active - 1 + c.items.length) % c.items.length }))
      return
    }
    if (completion.items.length && e.key === 'Escape') {
      setCompletion((c) => ({ ...c, items: [] }))
      return
    }
    if (completion.items.length && e.key === 'Enter' && acceptCompletion()) {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const ta = taRef.current
      const before = value.slice(0, ta.selectionStart)
      const line = before.slice(before.lastIndexOf('\n') + 1)
      const indentation = (line.match(/^\s*/) || [''])[0]
      const extra = /[({[]\s*$/.test(line) || (language === 'python' && /:\s*$/.test(line)) ? indentWidth(language) : ''
      document.execCommand('insertText', false, `\n${indentation}${extra}`)
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
        {marks && (
          <pre
            ref={markRef}
            aria-hidden
            className={`pointer-events-none absolute top-0 left-0 m-0 min-w-full text-transparent ${metrics}`}
            dangerouslySetInnerHTML={{ __html: marks }}
          />
        )}
        <pre
          ref={preRef}
          aria-hidden
          className={`pointer-events-none absolute top-0 left-0 m-0 min-w-full text-text ${metrics}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            refreshCompletion(e.target.value, e.target.selectionStart)
          }}
          onScroll={() => {
            syncScroll()
            setCompletion((c) => (c.items.length ? { ...c, items: [] } : c))
          }}
          onKeyDown={handleKeyDown}
          onClick={(e) => {
            // Ctrl/Cmd+clic on an import or a name opens the file it points to.
            if (e.ctrlKey || e.metaKey) openReference()
          }}
          onDoubleClick={() => setTimeout(openReference, 0)}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          className={`theme-scroll absolute inset-0 h-full w-full resize-none overflow-auto border-none bg-transparent text-transparent caret-[var(--color-text)] outline-none selection:bg-accent/30 ${metrics}`}
        />
        {completion.items.length > 0 && (
          <div
            className="absolute z-20 w-72 overflow-hidden rounded-md border border-border bg-surface shadow-xl"
            style={{ left: completion.left, top: completion.top }}
          >
            <div className="border-b border-border px-2 py-1 text-[10px] text-muted">Suggestions · Tab pour compléter</div>
            {completion.items.map((item, i) => (
              <button
                key={item}
                onMouseDown={(e) => { e.preventDefault(); acceptCompletion(i) }}
                className={`block w-full cursor-pointer truncate px-2 py-1 text-left font-mono text-xs ${i === completion.active ? 'bg-accent/25 text-text' : 'text-muted hover:bg-surface-hover hover:text-text'}`}
              >
                {item}
              </button>
            ))}
          </div>
        )}
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

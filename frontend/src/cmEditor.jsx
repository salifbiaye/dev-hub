import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands'
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  ensureSyntaxTree,
  foldGutter,
  foldKeymap,
  getIndentUnit,
  indentOnInput,
  indentString,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { diagnosticCount, lintGutter, lintKeymap, linter, nextDiagnostic } from '@codemirror/lint'
import { tags as t } from '@lezer/highlight'
import { completionItems, referenceTarget } from './editorHelpers'

// ------------------------------------------------------------------ languages

// One loader per language, so a file only ever pulls in its own parser.
const stream = (load, key, label) => async () => {
  const mod = await load()
  return { extension: StreamLanguage.define(mod[key]), label, lint: false }
}

const LOADERS = {
  js: async () => {
    const { javascript } = await import('@codemirror/lang-javascript')
    // JSX is common inside plain .js files (React projects), so it is on.
    return { extension: javascript({ jsx: true }), label: 'JavaScript', lint: true }
  },
  jsx: async () => {
    const { javascript } = await import('@codemirror/lang-javascript')
    return { extension: javascript({ jsx: true }), label: 'JSX', lint: true }
  },
  ts: async () => {
    const { javascript } = await import('@codemirror/lang-javascript')
    return { extension: javascript({ typescript: true }), label: 'TypeScript', lint: true }
  },
  tsx: async () => {
    const { javascript } = await import('@codemirror/lang-javascript')
    return { extension: javascript({ jsx: true, typescript: true }), label: 'TSX', lint: true }
  },
  json: async () => {
    const { json, jsonParseLinter } = await import('@codemirror/lang-json')
    return { extension: json(), label: 'JSON', lint: true, jsonLint: jsonParseLinter() }
  },
  // JSON with comments (tsconfig, .eslintrc…): strict JSON.parse would flag them.
  jsonc: async () => {
    const { json } = await import('@codemirror/lang-json')
    return { extension: json(), label: 'JSON (commentaires)', lint: false }
  },
  css: async () => {
    const { css } = await import('@codemirror/lang-css')
    return { extension: css(), label: 'CSS', lint: true }
  },
  scss: async () => {
    const { sass } = await import('@codemirror/lang-sass')
    return { extension: sass({ indented: false }), label: 'SCSS', lint: true }
  },
  sass: async () => {
    const { sass } = await import('@codemirror/lang-sass')
    return { extension: sass({ indented: true }), label: 'Sass', lint: false }
  },
  less: async () => {
    const { less } = await import('@codemirror/lang-less')
    return { extension: less(), label: 'Less', lint: true }
  },
  html: async () => {
    const { html } = await import('@codemirror/lang-html')
    return { extension: html(), label: 'HTML', lint: true }
  },
  xml: async () => {
    const { xml } = await import('@codemirror/lang-xml')
    return { extension: xml(), label: 'XML', lint: true }
  },
  py: async () => {
    const { python } = await import('@codemirror/lang-python')
    return { extension: python(), label: 'Python', lint: true }
  },
  java: async () => {
    const { java } = await import('@codemirror/lang-java')
    return { extension: java(), label: 'Java', lint: true }
  },
  sql: async () => {
    const { sql } = await import('@codemirror/lang-sql')
    return { extension: sql(), label: 'SQL', lint: false }
  },
  md: async () => {
    const { markdown } = await import('@codemirror/lang-markdown')
    return { extension: markdown(), label: 'Markdown', lint: false }
  },
  yaml: async () => {
    const { yaml } = await import('@codemirror/lang-yaml')
    return { extension: yaml(), label: 'YAML', lint: true }
  },
  php: async () => {
    const { php } = await import('@codemirror/lang-php')
    return { extension: php(), label: 'PHP', lint: false }
  },
  rs: async () => {
    const { rust } = await import('@codemirror/lang-rust')
    return { extension: rust(), label: 'Rust', lint: true }
  },
  go: async () => {
    const { go } = await import('@codemirror/lang-go')
    return { extension: go(), label: 'Go', lint: true }
  },
  cpp: async () => {
    const { cpp } = await import('@codemirror/lang-cpp')
    return { extension: cpp(), label: 'C / C++', lint: false }
  },
  // No Lezer grammar for these: highlighting and indentation only.
  sh: stream(() => import('@codemirror/legacy-modes/mode/shell'), 'shell', 'Shell'),
  docker: stream(() => import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile', 'Dockerfile'),
  toml: stream(() => import('@codemirror/legacy-modes/mode/toml'), 'toml', 'TOML'),
  ruby: stream(() => import('@codemirror/legacy-modes/mode/ruby'), 'ruby', 'Ruby'),
  swift: stream(() => import('@codemirror/legacy-modes/mode/swift'), 'swift', 'Swift'),
  kotlin: stream(() => import('@codemirror/legacy-modes/mode/clike'), 'kotlin', 'Kotlin'),
  csharp: stream(() => import('@codemirror/legacy-modes/mode/clike'), 'csharp', 'C#'),
  properties: stream(() => import('@codemirror/legacy-modes/mode/properties'), 'properties', 'Properties'),
  groovy: stream(() => import('@codemirror/legacy-modes/mode/groovy'), 'groovy', 'Groovy'),
}

const EXT_TO_LOADER = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx',
  json: 'json', webmanifest: 'json', jsonc: 'jsonc', json5: 'jsonc',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  xml: 'xml', svg: 'xml', xsd: 'xml', xsl: 'xml', plist: 'xml', csproj: 'xml', gpx: 'xml',
  py: 'py', pyw: 'py', java: 'java', sql: 'sql', md: 'md', markdown: 'md', mdx: 'md',
  yml: 'yaml', yaml: 'yaml', php: 'php', rs: 'rs', go: 'go',
  c: 'cpp', h: 'cpp', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  sh: 'sh', bash: 'sh', zsh: 'sh', toml: 'toml', rb: 'ruby', swift: 'swift',
  kt: 'kotlin', kts: 'kotlin', cs: 'csharp', env: 'properties', properties: 'properties',
  ini: 'properties', conf: 'properties', gradle: 'groovy', groovy: 'groovy',
}

// Files whose extension says "json" but that allow comments.
const JSONC_NAMES = new Set(['tsconfig.json', 'jsconfig.json', '.eslintrc', '.babelrc', '.prettierrc', 'settings.json', 'launch.json', 'tasks.json'])

function loaderKeyFor(file, text) {
  const base = file.slice(file.lastIndexOf('/') + 1).toLowerCase()
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'docker'
  if (base === '.env' || base.startsWith('.env.')) return 'properties'
  if (JSONC_NAMES.has(base) || /^tsconfig\..+\.json$/.test(base)) return 'jsonc'
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : ''
  if (EXT_TO_LOADER[ext]) return EXT_TO_LOADER[ext]
  // No usable extension: the shebang names the language.
  const newline = text.indexOf('\n')
  const first = text.startsWith('#!') ? text.slice(0, newline === -1 ? text.length : newline) : ''
  if (/\b(?:ba|z|da)?sh\b/.test(first)) return 'sh'
  if (/python/.test(first)) return 'py'
  if (/\bnode\b|\bdeno\b|\bbun\b/.test(first)) return 'js'
  if (/ruby/.test(first)) return 'ruby'
  return null
}

// Indentation each language conventionally uses when the file itself gives no hint.
const FOUR_SPACES = new Set(['py', 'java', 'php', 'rs', 'cpp', 'csharp', 'kotlin', 'swift', 'groovy'])

/**
 * What indentation the file already uses (an IDE follows the project, it
 * doesn't impose its own): tabs, or the most common step between indented
 * lines. Falls back to the language's convention.
 */
function detectIndent(text, fallback) {
  let tabs = 0
  let prev = 0
  const steps = new Map()
  for (const line of text.split('\n', 500)) {
    if (!line.trim()) continue
    if (line[0] === '\t') {
      tabs++
      continue
    }
    const n = line.length - line.trimStart().length
    if (n !== prev) {
      const d = Math.abs(n - prev)
      if (n > 0 && d >= 2 && d <= 8) steps.set(d, (steps.get(d) || 0) + 1)
    }
    prev = n
  }
  const spaceVotes = [...steps.values()].reduce((a, b) => a + b, 0)
  if (tabs >= 3 && tabs > spaceVotes) return '\t'
  let best = null
  for (const size of [2, 4, 8, 3]) {
    if ((steps.get(size) || 0) >= 3 && (!best || steps.get(size) > steps.get(best))) best = size
  }
  return best ? ' '.repeat(best) : fallback
}

function indentLabel(unit) {
  return unit === '\t' ? 'Tabulations' : `Espaces : ${unit.length}`
}

// ------------------------------------------------------------------- linting

// Lezer is error-tolerant: instead of giving up at the first mistake it marks
// the broken spots as error nodes, which is exactly what red squiggles need.
const syntaxLinter = linter(
  (view) => {
    const { state } = view
    const tree = ensureSyntaxTree(state, state.doc.length, 250)
    if (!tree) return []
    const out = []
    tree.iterate({
      enter(node) {
        if (out.length >= 50) return false
        if (!node.type.isError) return
        const len = state.doc.length
        const missing = node.to === node.from
        let from = node.from
        let to = node.to
        if (missing) {
          to = Math.min(len, from + 1)
          if (to === from) from = Math.max(0, from - 1)
        }
        const snippet = state.doc.sliceString(node.from, Math.min(node.to, node.from + 30)).replace(/\s+/g, ' ').trim()
        out.push({
          from,
          to,
          severity: 'error',
          message: missing
            ? 'Il manque quelque chose ici (parenthèse, accolade, guillemet, virgule…).'
            : `Erreur de syntaxe${snippet ? ` près de « ${snippet} »` : ''}.`,
        })
        return false
      },
    })
    return out
  },
  { delay: 350 },
)

// ---------------------------------------------------------------- find marks

const setFind = StateEffect.define()

function buildFindMarks(state, term, activeLine) {
  if (!term) return Decoration.none
  const needle = term.toLowerCase()
  const builder = new RangeSetBuilder()
  let count = 0
  for (let i = 1; i <= state.doc.lines && count < 2000; i++) {
    const line = state.doc.line(i)
    const low = line.text.toLowerCase()
    let at = low.indexOf(needle)
    let first = true
    while (at !== -1 && count < 2000) {
      const cls = i - 1 === activeLine && first ? 'cm-find-mark cur' : 'cm-find-mark'
      builder.add(line.from + at, line.from + at + needle.length, Decoration.mark({ class: cls }))
      first = false
      count++
      at = low.indexOf(needle, at + needle.length)
    }
  }
  return builder.finish()
}

const findField = StateField.define({
  create: () => ({ term: '', line: -1, marks: Decoration.none }),
  update(value, tr) {
    let { term, line } = value
    let changed = tr.docChanged
    for (const e of tr.effects) {
      if (e.is(setFind)) {
        term = e.value.term
        line = e.value.line
        changed = true
      }
    }
    return changed ? { term, line, marks: buildFindMarks(tr.state, term, line) } : value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.marks),
})

// -------------------------------------------------------------------- theme

// Colors are the app's own CSS variables, so the editor follows whichever of
// the themes is active (and Prism's read-only view uses the same mapping).
const mix = (name, pct) => `color-mix(in srgb, var(${name}) ${pct}%, transparent)`

// Read-only view of a file with its uncommitted changes: the new text is the
// document; added lines are tinted and removed lines hang above where they were,
// as blocks. `rows` are the diff rows ({ type: 'ctx' | 'add' | 'rem', text }).
const setDiff = StateEffect.define()

class RemovedBlock extends WidgetType {
  constructor(lines) {
    super()
    this.lines = lines
  }

  eq(other) {
    return other.lines.join('\n') === this.lines.join('\n')
  }

  toDOM() {
    const box = document.createElement('div')
    box.className = 'cm-diff-removed'
    for (const text of this.lines) {
      const row = document.createElement('div')
      row.className = 'cm-diff-removed-line'
      row.textContent = text === '' ? ' ' : text
      box.appendChild(row)
    }
    return box
  }

  ignoreEvent() {
    return true
  }
}

function buildDiff(doc, rows) {
  const ranges = []
  let n = 1
  let pending = []
  const flush = (atEnd) => {
    if (!pending.length) return
    const block = Decoration.widget({ widget: new RemovedBlock(pending), block: true, side: atEnd ? 1 : -1 })
    ranges.push(block.range(n <= doc.lines ? doc.line(n).from : doc.length))
    pending = []
  }
  for (const row of rows || []) {
    if (row.type === 'rem') {
      pending.push(row.text)
      continue
    }
    flush(false)
    if (row.type === 'add' && n <= doc.lines) ranges.push(Decoration.line({ class: 'cm-diff-add' }).range(doc.line(n).from))
    n += 1
  }
  flush(n > doc.lines)
  return Decoration.set(ranges, true)
}

const diffField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setDiff)) return buildDiff(tr.state.doc, e.value)
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

function makeTheme(dark) {
  return EditorView.theme(
    {
      '&': { height: '100%', backgroundColor: 'var(--color-base)', color: 'var(--color-text)', fontSize: '12px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '20px', overflow: 'auto' },
      '.cm-content': { caretColor: 'var(--color-text)', padding: '8px 0' },
      '.cm-line': { padding: '0 12px' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-text)' },
      '.cm-gutters': {
        backgroundColor: 'var(--color-surface)',
        color: mix('--color-muted', 70),
        border: 'none',
        borderRight: '1px solid var(--color-border)',
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '36px' },
      '.cm-activeLine': { backgroundColor: mix('--color-text', 5) },
      '.cm-activeLineGutter': { backgroundColor: mix('--color-text', 6), color: 'var(--color-text)' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: mix('--color-accent', 28),
      },
      '.cm-matchingBracket': { backgroundColor: mix('--color-accent', 30), outline: `1px solid ${mix('--color-accent', 60)}` },
      '.cm-nonmatchingBracket': { backgroundColor: mix('--color-danger', 30) },
      '.cm-foldPlaceholder': { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' },
      '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', padding: '0 4px' },
      '.cm-find-mark': { borderRadius: '2px', backgroundColor: mix('--color-warning', 35) },
      '.cm-diff-add': { backgroundColor: 'var(--color-success-bg)', boxShadow: 'inset 2px 0 0 var(--color-success)' },
      '.cm-diff-removed': { backgroundColor: 'var(--color-danger-bg)', boxShadow: 'inset 2px 0 0 var(--color-danger)', userSelect: 'text' },
      '.cm-diff-removed-line': { padding: '0 12px', whiteSpace: 'pre', color: 'var(--color-danger)', opacity: '0.9' },
      '.cm-find-mark.cur': { backgroundColor: mix('--color-warning', 75) },
      '.cm-tooltip': {
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: '6px',
        overflow: 'hidden',
      },
      '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '12px', maxHeight: '14em' },
      '.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px' },
      '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: mix('--color-accent', 28), color: 'var(--color-text)' },
      '.cm-completionDetail': { color: 'var(--color-muted)' },
      '.cm-diagnostic': { fontFamily: 'var(--font-sans)', fontSize: '12px', padding: '4px 8px' },
      '.cm-diagnostic-error': { borderLeft: '3px solid var(--color-danger)' },
    },
    { dark },
  )
}

const highlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--color-muted)', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier, t.self], color: 'var(--color-accent)' },
  { tag: [t.tagName, t.heading, t.link, t.url], color: 'var(--color-accent)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.inserted], color: 'var(--color-success)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.constant(t.name), t.unit], color: 'var(--color-warning)' },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: 'var(--color-warning)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.className, t.typeName, t.namespace, t.macroName], color: 'var(--color-danger)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.angleBracket, t.squareBracket, t.paren, t.brace, t.derefOperator], color: 'var(--color-muted)' },
  { tag: [t.strong, t.heading], fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.deleted, color: 'var(--color-danger)' },
  { tag: t.invalid, color: 'var(--color-danger)', textDecoration: 'underline wavy' },
])

// Tab: take the open suggestion, indent the selected lines, or — with just a
// caret — insert the file's own indent unit (insertTab would put a raw tab
// character in a project that indents with spaces).
function tabCommand(view) {
  if (acceptCompletion(view)) return true
  const { state } = view
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore(view)
  view.dispatch(
    state.update(state.replaceSelection(indentString(state, getIndentUnit(state))), { scrollIntoView: true, userEvent: 'input' }),
  )
  return true
}

const isDarkTheme = () => (getComputedStyle(document.documentElement).colorScheme || 'dark').includes('dark')

// -------------------------------------------------------------------- editor

export default function CmEditor({
  value,
  onChange,
  onSave,
  language,
  file,
  projectFiles = [],
  onOpenFile,
  onNotify,
  findTerm = '',
  findLine = -1,
  readOnly = false,
  diff = null,
  ref,
}) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const latest = useRef({})
  latest.current = { onChange, onSave, onOpenFile, onNotify, file, projectFiles, language }
  const [info, setInfo] = useState({ line: 1, col: 1, errors: 0 })
  const [lang, setLang] = useState({ label: '…', indent: '', lint: false })
  const compartments = useRef({ lang: new Compartment(), indent: new Compartment(), theme: new Compartment() }).current

  useImperativeHandle(ref, () => ({
    // What is selected, with its (1-based) line range; null when nothing is.
    getSelection() {
      const view = viewRef.current
      if (!view) return null
      const { from, to } = view.state.selection.main
      if (from === to) return null
      return {
        text: view.state.sliceDoc(from, to),
        fromLine: view.state.doc.lineAt(from).number,
        toLine: view.state.doc.lineAt(to).number,
      }
    },
    reveal(line, col) {
      const view = viewRef.current
      if (!view) return
      const doc = view.state.doc
      const target = doc.line(Math.min(Math.max(line, 0) + 1, doc.lines))
      view.dispatch({ effects: EditorView.scrollIntoView(target.from + Math.min(col || 0, target.length), { y: 'center' }) })
    },
  }))

  useEffect(() => {
    function openReferenceAt(view, pos) {
      const { file: f, projectFiles: files, onOpenFile: open, onNotify: notify } = latest.current
      const line = view.state.doc.lineAt(pos)
      const target = referenceTarget(line.text, pos - line.from, f, files, view.state.doc.toString())
      if (target) open?.(target)
      else notify?.('Référence locale introuvable')
    }

    // Import paths and symbols from the file, next to whatever the language
    // itself suggests (keywords, tags, CSS properties…).
    const projectCompletion = (ctx) => {
      const { language: lng, file: f, projectFiles: files } = latest.current
      const word = ctx.matchBefore(/[\w$./-]*/)
      if (!word || (word.from === word.to && !ctx.explicit)) return null
      const found = completionItems(ctx.state.doc.toString(), ctx.pos, lng, f, files)
      if (!found.items.length) return null
      return {
        from: found.from,
        options: found.items.map((label) => ({ label, type: label.includes('/') ? 'file' : undefined })),
        validFor: /^[\w$./-]*$/,
      }
    }

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(highlightStyle),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ icons: false }),
          EditorState.languageData.of(() => [{ autocomplete: projectCompletion }]),
          highlightActiveLine(),
          findField,
          diffField,
          ...(readOnly ? [EditorState.readOnly.of(true)] : []),
          EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
          compartments.theme.of(makeTheme(isDarkTheme())),
          compartments.indent.of(indentUnit.of('  ')),
          compartments.lang.of([]),
          EditorView.domEventHandlers({
            // Ctrl/Cmd+click on an import or a name opens the file it points to.
            mousedown(event, v) {
              if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false
              const pos = v.posAtCoords({ x: event.clientX, y: event.clientY })
              if (pos == null) return false
              event.preventDefault()
              openReferenceAt(v, pos)
              return true
            },
          }),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                latest.current.onSave?.()
                return true
              },
            },
            {
              key: 'Mod-Enter',
              run: (v) => {
                openReferenceAt(v, v.state.selection.main.head)
                return true
              },
            },
            { key: 'Tab', run: tabCommand },
            { key: 'Shift-Tab', run: indentLess },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange?.(update.state.doc.toString())
            if (update.docChanged || update.selectionSet || update.transactions.length) {
              const head = update.state.selection.main.head
              const line = update.state.doc.lineAt(head)
              const next = { line: line.number, col: head - line.from + 1, errors: diagnosticCount(update.state) }
              setInfo((prev) => (prev.line === next.line && prev.col === next.col && prev.errors === next.errors ? prev : next))
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    if (!readOnly) view.focus()

    // The theme's light/dark flag follows the active app theme.
    const observer = new MutationObserver(() => view.dispatch({ effects: compartments.theme.reconfigure(makeTheme(isDarkTheme())) }))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })

    return () => {
      observer.disconnect()
      view.destroy()
      viewRef.current = null
    }
    // The editor is created once per file (FileViewer is keyed by it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Language + indentation of this file: parser loaded on demand.
  useEffect(() => {
    let alive = true
    const text = viewRef.current?.state.doc.toString() ?? value
    const key = loaderKeyFor(file, text)
    const fallbackIndent = key === 'go' ? '\t' : FOUR_SPACES.has(key) ? '    ' : '  '
    const unit = detectIndent(text, fallbackIndent)
    const view = viewRef.current
    view?.dispatch({
      effects: [
        compartments.indent.reconfigure([indentUnit.of(unit), EditorState.tabSize.of(unit === '\t' ? 4 : unit.length)]),
      ],
    })
    setLang((l) => ({ ...l, indent: indentLabel(unit) }))
    if (!key || !LOADERS[key]) {
      setLang({ label: 'Texte brut', indent: indentLabel(unit), lint: false })
      return
    }
    LOADERS[key]()
      .then((loaded) => {
        if (!alive || !viewRef.current) return
        const extensions = [loaded.extension]
        if (loaded.jsonLint) {
          extensions.push(
            linter((v) => loaded.jsonLint(v).map((d) => ({ ...d, message: `JSON invalide : ${d.message}` })), { delay: 350 }),
            lintGutter(),
          )
        } else if (loaded.lint) {
          extensions.push(syntaxLinter, lintGutter())
        }
        viewRef.current.dispatch({ effects: compartments.lang.reconfigure(extensions) })
        setLang({ label: loaded.label, indent: indentLabel(unit), lint: !!(loaded.lint || loaded.jsonLint) })
      })
      .catch(() => alive && setLang({ label: 'Texte brut', indent: indentLabel(unit), lint: false }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // The text is owned by FileViewer (drafts, save): follow external changes.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setDiff.of(diff) })
  }, [diff, value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setFind.of({ term: findTerm, line: findLine }) })
  }, [findTerm, findLine])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-base">
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
      <div className="flex shrink-0 items-center gap-4 border-t border-border bg-surface px-3 py-1 text-[11px] text-muted">
        <span className="font-medium text-text">{lang.label}</span>
        <span>
          Ln {info.line}, Col {info.col}
        </span>
        <span>{lang.indent}</span>
        {lang.lint &&
          (info.errors > 0 ? (
            <button
              onClick={() => {
                const view = viewRef.current
                if (view) {
                  view.focus()
                  nextDiagnostic(view)
                }
              }}
              className="ml-auto cursor-pointer text-danger hover:underline"
              title="Aller à l'erreur suivante (F8)"
            >
              ✕ {info.errors} erreur{info.errors > 1 ? 's' : ''} de syntaxe
            </button>
          ) : (
            <span className="ml-auto text-success">✓ Aucune erreur de syntaxe</span>
          ))}
      </div>
    </div>
  )
}

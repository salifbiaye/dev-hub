// Language-agnostic helpers of the Code tab's editor: word / import-path
// suggestions and « where does this import point » (Ctrl+click) — kept
// out of the CodeMirror component so they stay plain functions.

export const LANGUAGE_WORDS = {
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

export function indentWidth(language) {
  return language === 'python' ? '    ' : '  '
}

export function relativeImport(fromFile, target) {
  const from = fromFile.split('/').slice(0, -1)
  const to = target.split('/')
  while (from.length && to.length && from[0] === to[0]) {
    from.shift()
    to.shift()
  }
  return `${from.length ? '../'.repeat(from.length) : './'}${to.join('/')}`
}

export function completionItems(value, cursor, language, file, projectFiles) {
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

// Which icon the Code tab's file tree shows for a file, picked from its name.
// Icon keys are names from the Material Icon Theme set (the red Java cup, the
// React atom, the yellow JS…), extracted into fileIconData.js by
// scripts/gen-file-icons.mjs. Plain data so it can be checked outside React.

const BY_NAME = {
  dockerfile: 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  '.dockerignore': 'docker',
  'package.json': 'nodejs',
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  license: 'license',
  'license.md': 'license',
  'license.txt': 'license',
  makefile: 'makefile',
  '.editorconfig': 'editorconfig',
  '.prettierrc': 'prettier',
  '.eslintrc': 'eslint',
  '.eslintignore': 'eslint',
  '.env': 'tune',
}

// A name that starts with these (vite.config.ts, tsconfig.app.json…).
const BY_PREFIX = [
  ['tsconfig', 'tsconfig'],
  ['jsconfig', 'jsconfig'],
  ['.eslintrc', 'eslint'],
  ['eslint.config', 'eslint'],
  ['.prettierrc', 'prettier'],
  ['prettier.config', 'prettier'],
  ['vite.config', 'vite'],
  ['vitest.config', 'vitest'],
  ['tailwind.config', 'tailwindcss'],
  ['webpack.config', 'webpack'],
  ['jest.config', 'jest'],
  ['dockerfile', 'docker'],
  ['docker-compose', 'docker'],
  ['readme', 'readme'],
  ['.env', 'tune'],
]

const BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'react',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'react-ts',
  json: 'json', jsonc: 'json', json5: 'json',
  py: 'python', pyw: 'python',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  go: 'go',
  rs: 'rust',
  php: 'php',
  rb: 'ruby',
  cs: 'csharp',
  c: 'c', h: 'h',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'hpp',
  css: 'css', scss: 'sass', sass: 'sass', less: 'less',
  html: 'html', htm: 'html', vue: 'vue', svelte: 'svelte',
  md: 'markdown', mdx: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml',
  toml: 'toml', xml: 'xml', svg: 'svg',
  sh: 'console', bash: 'console', zsh: 'console', bat: 'console', cmd: 'console',
  ps1: 'powershell',
  sql: 'database',
  env: 'tune',
  ini: 'settings', conf: 'settings', properties: 'settings',
  gradle: 'gradle',
  graphql: 'graphql', gql: 'graphql', prisma: 'prisma',
  lock: 'lock',
  pdf: 'pdf',
  zip: 'zip', gz: 'zip', tar: 'zip', '7z': 'zip', rar: 'zip',
  log: 'log', csv: 'table', xls: 'table', xlsx: 'table', txt: 'document',
  doc: 'word', docx: 'word', ppt: 'powerpoint', pptx: 'powerpoint',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', ico: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio',
  exe: 'exe', dll: 'dll', bin: 'exe',
}

// Generic page icon for everything else.
export const GENERIC_ICON = 'document'

/** Every icon key a file can get (the generator extracts exactly these). */
export const ALL_ICON_KEYS = [
  ...new Set([...Object.values(BY_NAME), ...BY_PREFIX.map(([, k]) => k), ...Object.values(BY_EXT), GENERIC_ICON]),
]

/** Icon key for a file name (path or bare name), or GENERIC_ICON. */
export function fileIconKeyFor(name) {
  const base = name.slice(name.lastIndexOf('/') + 1).toLowerCase()
  if (BY_NAME[base]) return BY_NAME[base]
  for (const [prefix, key] of BY_PREFIX) if (base.startsWith(prefix)) return key
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : ''
  return BY_EXT[ext] || GENERIC_ICON
}

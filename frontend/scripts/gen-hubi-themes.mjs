// Extrait la couleur d'accent de chaque thème de src/index.css vers
// public/hubi/themes.json : les yeux de Hubi s'accordent ainsi au thème de
// Dev Hub sans dupliquer la liste des thèmes à la main.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src', 'index.css'), 'utf8')

const themes = {}
// Le thème par défaut (« dark ») vit dans le bloc @theme de Tailwind.
const blockRe = /(?::root(?:\[data-theme=['"]([\w-]+)['"]\])?|@theme)\s*\{([^}]*)\}/g
for (const [, name, body] of css.matchAll(blockRe)) {
  const accent = body.match(/--color-accent:\s*(#[0-9a-fA-F]{6})\b/)
  if (accent) themes[name || 'dark'] = accent[1].toLowerCase()
}

writeFileSync(join(root, 'public', 'hubi', 'themes.json'), JSON.stringify(themes, null, 2) + '\n')
console.log(`hubi: ${Object.keys(themes).length} thèmes -> public/hubi/themes.json`)

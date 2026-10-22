#!/usr/bin/env node
// The desktop build keeps each Phosphor icon's duotone weight only for the
// icons packages/ui/src/duotone.ts imports (`phosphorWeights` in
// apps/desktop/renderer.vite.ts). Any other icon asked for duotone
// would draw nothing. `IconWeight` has no duotone, so the types send every
// duotone icon through duotone.ts; this check closes the rest: it fails on
// the weight's name as a string anywhere else (a Phosphor icon drawn
// directly, an `IconContext`), and on an icon duotone.ts wraps without
// importing it from the path the build reads.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['apps', 'packages']
const skip = new Set(['node_modules', 'out', 'dist', 'release', 'test-results', 'playwright-report'])
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const list = 'packages/ui/src/duotone.ts'
const allowed = new Set([list, 'apps/desktop/renderer.vite.ts'])
const pattern = /['"`]duotone['"`]/

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (extensions.has(path.extname(entry.name))) yield full
  }
}

const hits = []
for (const base of roots) {
  for await (const file of walk(path.join(root, base))) {
    const relative = path.relative(root, file)
    if (allowed.has(relative)) continue
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${relative}:${i + 1}: ${line.trim()}`)
    })
  }
}

const source = await readFile(path.join(root, list), 'utf8')
const imported = new Set(Array.from(source.matchAll(/import \{ ([A-Za-z0-9]+) \} from '@phosphor-icons\/react\/dist\/icons\/\1'/g), (match) => match[1]))
const wrapped = Array.from(source.matchAll(/\bduotone\(([A-Za-z0-9]+)\)/g), (match) => match[1])
const unread = wrapped.filter((name) => !imported.has(name))
if (wrapped.length === 0) hits.push(`${list}: wraps no icon`)
for (const name of unread) hits.push(`${list}: ${name} is not imported from '@phosphor-icons/react/dist/icons/${name}', so the build would drop its duotone weight`)

if (hits.length > 0) {
  console.error(`check-duotone: duotone icons come only from ${list} (see its comment):`)
  for (const hit of hits) console.error('  ' + hit)
  process.exit(1)
}
console.log(`check-duotone: ok, ${wrapped.length} duotone icon(s)`)

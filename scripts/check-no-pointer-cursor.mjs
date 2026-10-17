#!/usr/bin/env node
// Juno never uses the pointer (hand) cursor. macOS apps use the arrow cursor
// on buttons, rows, tabs and menu items. This script fails the lint step if
// any source file sets cursor: pointer, in StyleX, CSS, or inline styles.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['apps', 'packages']
const skip = new Set(['node_modules', 'out', 'dist', 'release', 'test-results', 'playwright-report'])
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.html'])
const pattern = /cursor\s*:\s*['"]?pointer\b/i
// Only message links that open in the browser may use the hand cursor.
const allowlist = new Map([['packages/views/src/MessageLink.tsx', '// external-link-cursor']])

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
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        const relative = path.relative(root, file)
        if (allowlist.get(relative) === undefined || !line.includes(allowlist.get(relative))) {
          hits.push(`${relative}:${i + 1}: ${line.trim()}`)
        }
      }
    })
  }
}

if (hits.length > 0) {
  console.error('cursor: pointer is not allowed (see docs/design/handoff/SPEC.md, "Feels native"):')
  for (const hit of hits) console.error('  ' + hit)
  process.exit(1)
}
console.log('check-no-pointer-cursor: ok')

#!/usr/bin/env bun
// Holds the renderer to the bundle budget in docs/performance.md section 1:
// initial JS at most 1.2 MB and CSS at most 200 KB, uncompressed. "Initial"
// means what index.html loads before any user action: its <script> tags,
// <link rel="modulepreload"> and stylesheets. Lazy chunks are not counted.
//
// Runs at the end of `bun run build` (apps/desktop/package.json) and fails the
// build when a budget is exceeded. Prints gzip sizes too, for the record.
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

if (process.env.JUNO_UNMINIFIED === '1') {
  console.log('bundle size: not checked, the build is unminified (JUNO_UNMINIFIED=1)')
  process.exit(0)
}

const JS_BUDGET = 1_200_000
const CSS_BUDGET = 200_000

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rendererDir = join(root, 'apps/desktop/out/renderer')
const html = readFileSync(join(rendererDir, 'index.html'), 'utf8')

const initial = { js: [], css: [] }
for (const match of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) initial.js.push(match[1])
for (const match of html.matchAll(/<link[^>]*\srel="modulepreload"[^>]*\shref="([^"]+)"/g)) initial.js.push(match[1])
for (const match of html.matchAll(/<link[^>]*\srel="stylesheet"[^>]*\shref="([^"]+)"/g)) initial.css.push(match[1])

function measure(files) {
  let bytes = 0
  let gzip = 0
  for (const file of files) {
    const path = join(rendererDir, file.replace(/^\.\//, ''))
    bytes += statSync(path).size
    gzip += gzipSync(readFileSync(path)).length
  }
  return { bytes, gzip, count: files.length }
}

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} KB`

const js = measure(initial.js)
const css = measure(initial.css)
console.log(`check-bundle-size: initial JS ${kb(js.bytes)} (${kb(js.gzip)} gzip, ${js.count} file(s)), budget ${kb(JS_BUDGET)}`)
console.log(`check-bundle-size: initial CSS ${kb(css.bytes)} (${kb(css.gzip)} gzip, ${css.count} file(s)), budget ${kb(CSS_BUDGET)}`)

const failures = []
if (js.count === 0) failures.push('index.html loads no script')
if (js.bytes > JS_BUDGET) failures.push(`initial JS ${kb(js.bytes)} is over the ${kb(JS_BUDGET)} budget`)
if (css.bytes > CSS_BUDGET) failures.push(`initial CSS ${kb(css.bytes)} is over the ${kb(CSS_BUDGET)} budget`)

if (failures.length > 0) {
  console.error(`check-bundle-size: ${failures.join('; ')}. See docs/performance.md section 1.`)
  process.exit(1)
}
console.log('check-bundle-size: ok')

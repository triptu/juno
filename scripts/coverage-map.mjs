// Builds the e2e coverage map that `pnpm affected` selects desktop specs by
// (docs/development.md, "Affected tests").
//
//   node scripts/coverage-map.mjs reduce
//       After a desktop e2e run with JUNO_COVERAGE=1 (e2e/coverage.ts runs it):
//       maps what each launch ran (apps/desktop/coverage/raw, written by
//       src/coverage.ts) back to source files with the build's source maps,
//       and writes apps/desktop/coverage/map/partial-<shard>.json.
//   node scripts/coverage-map.mjs merge <partial.json or dir>... --commit <sha> [--out <file>]
//       Joins the partials of a full run into the committed map
//       (default apps/desktop/e2e/coverage-map.json).
//
// A source file counts for a spec when a function from it ran while one of the
// spec's tests had the app open. A module's own top level is not a function:
// in a bundle it runs at load for every test, so it says nothing about a spec.
// Files in a bundle whose functions no spec ran are listed as `moduleOnly`;
// affected treats a change to one as reaching every spec.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktop = join(root, 'apps/desktop')
export const MAP_PATH = 'apps/desktop/e2e/coverage-map.json'

const BASE64 = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((char, index) => [char, index]))

/** Decodes a source map's `mappings` into, per generated line, `[column, source index]` pairs in column order (-1: no source). */
export function decodeMappings(mappings) {
  const lines = []
  let source = 0
  for (const line of mappings.split(';')) {
    const segments = []
    let column = 0
    if (line !== '') {
      for (const segment of line.split(',')) {
        const values = []
        let value = 0
        let shift = 0
        for (const char of segment) {
          const digit = BASE64[char]
          value += (digit & 31) * 2 ** shift
          if (digit & 32) shift += 5
          else {
            values.push(value % 2 === 1 ? -Math.floor(value / 2) : value / 2)
            value = 0
            shift = 0
          }
        }
        column += values[0]
        if (values.length >= 4) {
          source += values[1]
          segments.push([column, source])
        } else segments.push([column, -1])
        // Lines and columns in the source are not needed, only which file.
      }
    }
    lines.push(segments)
  }
  return lines
}

/** The source index at a generated line and column: the last segment that starts at or before it. */
export function sourceAt(lines, line, column) {
  const segments = lines[line]
  if (segments === undefined) return -1
  let low = 0
  let high = segments.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (segments[middle][0] <= column) {
      found = segments[middle][1]
      low = middle + 1
    } else high = middle - 1
  }
  return found
}

/** Turns character offsets into lines and columns. */
function lineStarts(text) {
  const starts = [0]
  for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) starts.push(index + 1)
  return starts
}
function position(starts, offset) {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle] <= offset) low = middle
    else high = middle - 1
  }
  return [low, offset - starts[low]]
}

/** Repo files only: workspace sources under apps/ and packages/, not dependencies or virtual modules. */
const repoFile = (path) => {
  const file = relative(root, path).split('\\').join('/')
  return /^(apps|packages)\//.test(file) && !file.includes('node_modules/') && existsSync(path) ? file : undefined
}

/** One built script and its map, loaded once. */
const bundles = new Map()
function bundle(file) {
  if (bundles.has(file)) return bundles.get(file)
  let loaded
  if (existsSync(file) && existsSync(`${file}.map`)) {
    const map = JSON.parse(readFileSync(`${file}.map`, 'utf8'))
    const base = resolve(dirname(file), map.sourceRoot ?? '')
    loaded = { starts: lineStarts(readFileSync(file, 'utf8')), lines: decodeMappings(map.mappings), sources: map.sources.map((source) => repoFile(resolve(base, source))) }
  }
  bundles.set(file, loaded)
  return loaded
}

/** The built file a coverage URL names: file:///…/out/main/engine.js or juno://app/assets/index.js. */
function builtFile(url) {
  const app = /^juno:\/\/app\/(.+)$/.exec(url)
  if (app) return join(desktop, 'out/renderer', decodeURIComponent(app[1].split(/[?#]/)[0]))
  const out = /\/out\/(main|preload|renderer)\/(.+)$/.exec(url)
  return out ? join(desktop, 'out', out[1], decodeURIComponent(out[2])) : undefined
}

const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map((name) => join(dir, String(name))).filter((path) => statSync(path).isFile()) : [])

/** The repo files in every bundle under out/. */
function bundled() {
  const files = new Set()
  for (const map of walk(join(desktop, 'out')).filter((path) => path.endsWith('.js.map'))) for (const source of bundle(map.slice(0, -4))?.sources ?? []) if (source) files.add(source)
  return files
}

function reduce() {
  const raw = join(desktop, 'coverage/raw')
  const specs = {}
  let mapped = 0
  let unmapped = 0
  for (const specDir of existsSync(raw) ? readdirSync(raw) : []) {
    if (specDir === 'unknown') continue
    const spec = `apps/desktop/${specDir.replaceAll('__', '/')}`
    const files = new Set(specs[spec] ?? [])
    for (const write of walk(join(raw, specDir)).filter((path) => path.endsWith('.json'))) {
      for (const [url, offsets] of Object.entries(JSON.parse(readFileSync(write, 'utf8')))) {
        const built = builtFile(url)
        const loaded = built && bundle(built)
        if (!loaded) {
          unmapped += offsets.length
          continue
        }
        for (const offset of offsets) {
          const source = loaded.sources[sourceAt(loaded.lines, ...position(loaded.starts, offset))]
          if (source) {
            files.add(source)
            mapped++
          } else unmapped++
        }
      }
    }
    specs[spec] = [...files].toSorted()
  }
  const shard = process.env.JUNO_SHARD?.replace('/', '-of-') ?? 'all'
  const out = join(desktop, 'coverage/map', `partial-${shard}.json`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify({ specs, bundled: [...bundled()].toSorted() })}\n`)
  rmSync(raw, { recursive: true, force: true })
  console.log(`coverage-map: ${Object.keys(specs).length} spec file(s), ${mapped} function start(s) in repo files, ${unmapped} in dependencies or unmapped; wrote ${relative(root, out)}`)
}

/** Joins partials into the committed map: every spec, and per file the indices of the specs that ran it. */
export function mergePartials(partials, commit, recordedAt = new Date().toISOString()) {
  const specFiles = new Map()
  const inBundle = new Set()
  for (const partial of partials) {
    for (const [spec, files] of Object.entries(partial.specs)) specFiles.set(spec, new Set([...(specFiles.get(spec) ?? []), ...files]))
    for (const file of partial.bundled) inBundle.add(file)
  }
  const specs = [...specFiles.keys()].toSorted()
  const files = {}
  for (const [index, spec] of specs.entries()) for (const file of specFiles.get(spec)) (files[file] ??= []).push(index)
  const sortedFiles = Object.fromEntries(Object.entries(files).toSorted(([a], [b]) => (a < b ? -1 : 1)))
  const moduleOnly = [...inBundle].filter((file) => !(file in files)).toSorted()
  return { version: 1, commit, recordedAt, specs, files: sortedFiles, moduleOnly }
}

/** One file per line, so a refresh reads as a diff of what changed. */
export function formatMap(map) {
  const lines = [
    '{',
    `  "version": ${map.version},`,
    `  "commit": ${JSON.stringify(map.commit)},`,
    `  "recordedAt": ${JSON.stringify(map.recordedAt)},`,
    '  "specs": [',
    map.specs.map((spec) => `    ${JSON.stringify(spec)}`).join(',\n'),
    '  ],',
    '  "files": {',
    Object.entries(map.files).map(([file, indices]) => `    ${JSON.stringify(file)}: [${indices.join(',')}]`).join(',\n'),
    '  },',
    '  "moduleOnly": [',
    map.moduleOnly.map((file) => `    ${JSON.stringify(file)}`).join(',\n'),
    '  ]',
    '}',
  ]
  return `${lines.filter((line) => line !== '').join('\n')}\n`
}

function merge(args) {
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const commit = option('--commit')
  if (!commit) throw new Error('merge needs --commit <sha>')
  const out = resolve(root, option('--out') ?? MAP_PATH)
  const inputs = args.filter((arg, index) => !arg.startsWith('--') && !['--commit', '--out'].includes(args[index - 1]))
  const partials = inputs.flatMap((input) => (statSync(input).isDirectory() ? walk(input).filter((path) => /partial-[^/]*\.json$/.test(path)) : [input]))
  if (partials.length === 0) throw new Error('merge found no partial-*.json')
  const map = mergePartials(partials.map((path) => JSON.parse(readFileSync(path, 'utf8'))), commit)
  writeFileSync(out, formatMap(map))
  console.log(`coverage-map: ${map.specs.length} spec file(s), ${Object.keys(map.files).length} file(s) run, ${map.moduleOnly.length} module-only, from ${partials.length} partial(s); wrote ${relative(root, out)}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'reduce') reduce()
  else if (command === 'merge') merge(args)
  else {
    console.error('usage: node scripts/coverage-map.mjs reduce | merge <partials...> --commit <sha> [--out <file>]')
    process.exit(2)
  }
}

// `bun run demo:build` (docs/development.md, "Demo"): exports a fresh snapshot from the engine and
// builds the read-only demo into apps/desktop/web/demo/dist/, through build-cached so an unchanged
// checkout reuses the last one, then prints what a visitor downloads. A folder of static files:
// serve it from any path (`python3 -m http.server -d apps/desktop/web/demo/dist`).
//
// `--out <folder>` then copies it there, in place of a demo already there (`--out site/try` for the
// site). `--from <folder>` takes a build made elsewhere, such as the one `bun run remote demo:build`
// brought back, instead of building here.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = join(root, 'apps/desktop')
const { values: flags } = parseArgs({ options: { out: { type: 'string' }, from: { type: 'string' } } })
const dist = flags.from === undefined ? join(app, 'web/demo/dist') : resolve(flags.from)

if (flags.from === undefined) {
  const built = spawnSync(process.execPath, [join(root, 'scripts/build-cached.mjs'), 'web/demo/dist', 'bun', 'run', 'build:demo'], { cwd: app, stdio: 'inherit' })
  if (built.status !== 0) process.exit(built.status ?? 1)
}
if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'demo/snapshot.json'))) throw new Error(`demo:build: ${dist} is not a demo build`)

const snapshot = JSON.parse(readFileSync(join(dist, 'demo/snapshot.json'), 'utf8'))
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
if (snapshot.commit !== 'unknown' && snapshot.commit !== head) console.warn(`demo:build: the snapshot is from ${snapshot.commit.slice(0, 9)}, not HEAD ${head.slice(0, 9)}; commit, then build again`)

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
const size = (file) => {
  const bytes = readFileSync(file)
  return { raw: bytes.length, gzip: gzipSync(bytes).length }
}
// What the first load fetches: the page, the scripts and sheets it names, and the snapshot. Lazy chunks, fonts and files come later.
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const first = ['index.html', ...[...html.matchAll(/(?:src|href)="\.\/([^"]+\.(?:js|css))"/g)].map((match) => match[1]), 'demo/snapshot.json']
const sum = (files) => files.map((file) => size(join(dist, file))).reduce((a, b) => ({ raw: a.raw + b.raw, gzip: a.gzip + b.gzip }), { raw: 0, gzip: 0 })
const lines = [
  ...first.map((file) => [file, size(join(dist, file))]),
  ['first load', sum(first)],
  ['demo/files/', sum(walk(join(dist, 'demo/files')).map((file) => relative(dist, file)))],
  ['everything', sum(walk(dist).map((file) => relative(dist, file)))],
]
for (const [name, { raw, gzip }] of lines) console.log(`demo:build: ${name.padEnd(40)} ${kb(raw).padStart(10)} ${kb(gzip).padStart(10)} gzip`)
console.log(`demo:build: ${relative(root, dist)}/, snapshot of ${snapshot.commit.slice(0, 9)}, ${statSync(join(dist, 'demo/snapshot.json')).size} bytes`)

if (flags.out !== undefined) {
  const out = resolve(flags.out)
  // Only ever an empty place or an earlier demo: never a folder that holds anything else, such as the site itself.
  if (existsSync(out) && readdirSync(out).length > 0 && !existsSync(join(out, 'demo/snapshot.json'))) throw new Error(`demo:build: ${out} holds something other than a demo; not replacing it`)
  rmSync(out, { recursive: true, force: true })
  // build-cached's marker is for this checkout's reuse, not for visitors.
  cpSync(dist, out, { recursive: true, filter: (source) => basename(source) !== '.inputs-hash' })
  console.log(`demo:build: copied to ${relative(root, out)}/`)
}

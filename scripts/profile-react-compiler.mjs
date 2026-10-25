// Times renderer, web and gallery builds with the Babel React Compiler pass (empty
// cache, then full cache) against Oxc's port, interleaved, and records each build's
// memo cache sites and bundle sizes. Results go to apps/desktop/test-results/rc/,
// which `bun run remote` brings back. Run on the runner, never on the Mac.
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const desktop = join(root, 'apps/desktop')
const gallery = join(root, 'apps/gallery')
const results = join(desktop, 'test-results/rc')
mkdirSync(results, { recursive: true })
const log = []
const record = (entry) => {
  log.push(entry)
  console.log(JSON.stringify(entry))
  writeFileSync(join(results, 'builds.json'), JSON.stringify(log, null, 1))
}

/** Runs a command under bash's `time`, which counts the CPU of every child process. */
let runs = 0
function timed(cwd, command, env) {
  const output = join(results, `build-${runs++}.log`)
  const result = spawnSync('bash', ['-c', `TIMEFORMAT='%R %U %S'; { time (${command}) > '${output}' 2>&1 ; } 2>&1`], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' })
  const [wall, user, sys] = result.stdout.trim().split('\n').at(-1).split(' ').map(Number)
  const text = readFileSync(output, 'utf8')
  if (result.status !== 0) console.error(text)
  return { ok: result.status === 0, wall, cpu: Math.round((user + sys) * 10) / 10, log: output, compilerLines: text.split('\n').filter((line) => /react-compiler|React Compiler/i.test(line)).length }
}

function sizes(dir) {
  const files = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(?:js|css)$/.test(name)) files.push(path)
    }
  }
  walk(dir)
  let js = 0
  let css = 0
  let jsGzip = 0
  for (const file of files) {
    const bytes = readFileSync(file)
    if (file.endsWith('.js')) {
      js += bytes.length
      jsGzip += gzipSync(bytes).length
    } else css += bytes.length
  }
  return { js, jsGzip, css }
}

function probeSummary(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const counts = Object.values(data)
  return { modules: counts.length, sites: counts.reduce((sum, list) => sum + list.length, 0), slots: counts.reduce((sum, list) => sum + list.reduce((a, b) => a + b, 0), 0) }
}

const targets = {
  renderer: { cwd: desktop, command: 'JUNO_ELECTRON_TARGETS=renderer node_modules/.bin/electron-vite build --ignoreConfigWarning', out: join(desktop, 'out/renderer') },
  web: { cwd: desktop, command: 'rm -rf dist && node_modules/.bin/vite build -c vite.web.config.ts', out: join(desktop, 'dist') },
  gallery: { cwd: gallery, command: 'node_modules/.bin/vite build', out: join(gallery, 'dist') },
}

function build(target, variant, cacheDir, round) {
  const { cwd, command, out } = targets[target]
  const probe = join(results, `probe-${target}-${variant}-${round}.json`)
  const env = { JUNO_REACT_COMPILER: variant.startsWith('babel') ? 'babel' : 'oxc', JUNO_BUILD_CACHE_DIR: cacheDir, JUNO_REACT_COMPILER_PROBE: probe }
  const time = timed(cwd, command, env)
  const entry = { target, variant, round, ...time, ...sizes(out), ...probeSummary(probe) }
  if (target === 'renderer' && round === 0) {
    entry.budget = execFileSync('bun', [join(root, 'scripts/check-bundle-size.mjs')], { cwd: desktop, encoding: 'utf8' }).trim()
    cpSync(out, join(results, `out-${variant}`), { recursive: true })
  }
  record(entry)
}

const fresh = () => mkdtempSync(join(tmpdir(), 'rc-cache-'))
for (let round = 0; round < 3; round++) {
  const cache = fresh()
  build('renderer', 'babel-cold', cache, round)
  build('renderer', 'oxc', fresh(), round)
  build('renderer', 'babel-warm', cache, round)
}
for (const target of ['web', 'gallery']) {
  const cache = fresh()
  build(target, 'babel-cold', cache, 0)
  build(target, 'oxc', fresh(), 0)
  build(target, 'babel-warm', cache, 0)
}

// The per-file comparison, against the Babel plugin Juno pins and the experimental build Oxc ports.
const compare = (env, name) => {
  const result = spawnSync('node', [join(root, 'scripts/react-compiler-compare.mjs'), '--out', join(results, `diff-${name}`)], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' })
  writeFileSync(join(results, `compare-${name}.json`), result.stdout)
  if (result.status !== 0) console.error(result.stderr)
}
compare({}, 'stable')
const experimental = mkdtempSync(join(tmpdir(), 'rc-exp-'))
writeFileSync(join(experimental, 'package.json'), '{"name":"rc-exp","private":true}')
const add = spawnSync('bun', ['add', 'babel-plugin-react-compiler@0.0.0-experimental-a1856f3-20260507'], { cwd: experimental, encoding: 'utf8' })
if (add.status === 0) compare({ BABEL_REACT_COMPILER: join(experimental, 'node_modules/babel-plugin-react-compiler') }, 'experimental')
else console.error(add.stderr)

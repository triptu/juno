// Reuses only builds whose source, toolchain, environment and output bytes match.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const [outDir, ...command] = process.argv.slice(2)
if (!outDir || command.length === 0) throw new Error('usage: build-cached.mjs <output dir> <command> [args...]')
const app = process.cwd()
const root = resolve(app, '../..')
const output = join(app, outDir)
const marker = '.inputs-hash'
const ignored = new Set(['node_modules', '.git', 'out', 'dist', 'test-results', 'playwright-report', 'blob-report', 'coverage', 'shots', 'feel-report', '.scratch'])
const walk = (dir, filter = () => true) => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (!filter(entry.name)) return []
  const path = join(dir, entry.name)
  return entry.isDirectory() ? walk(path, filter) : [path]
}) : []
const hashFiles = (base, files) => {
  const hash = createHash('sha256')
  for (const file of files.toSorted()) {
    hash.update(JSON.stringify([relative(base, file), existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null]))
  }
  return hash.digest('hex')
}
const rootFiles = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)
const inputs = [relative(root, app), 'packages', 'scripts', ...rootFiles]
const git = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...inputs], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
// Remote archives have no Git directory. Walk the same source roots, excluding generated files.
const files = git.status === 0 && git.stdout.length > 0
  ? [...new Set(git.stdout.split('\0').filter(Boolean))].map((file) => join(root, file))
  : inputs.flatMap((name) => {
    const path = join(root, name)
    return rootFiles.includes(name) ? [path] : walk(path, (part) => !ignored.has(part))
  })
// Vite reads ignored .env files too; their contents affect local builds.
const envFiles = [root, app].flatMap((dir) => readdirSync(dir).filter((name) => /^\.env(?:\.|$)/.test(name)).map((name) => join(dir, name)))
const buildInputs = [...new Set([...files, ...envFiles])].filter((file) => {
  const path = relative(app, file)
  const sourcePath = relative(root, file)
  if (/^(?:packages|apps)\/[^/]+\/(?:test|tests)\//.test(sourcePath) || /^scripts\/.*\.test\.mjs$/.test(sourcePath)) return false
  // The DOM lane's tests and driver are not in any build; its bundle's config is.
  if (path.startsWith('dom/') && path !== 'dom/vite.config.ts') return false
  return !path.startsWith('e2e/') && !/^[^/]+\.spec\.ts$|^playwright(?:\.[^/]*)?\.config\.ts$/.test(path)
})
const environment = Object.entries(process.env).filter(([name]) => /^(VITE_|ELECTRON_VITE_)/.test(name) || ['JUNO_UNMINIFIED', 'JUNO_COVERAGE', 'JUNO_REACT_COMPILER', 'NODE_ENV'].includes(name)).toSorted(([a], [b]) => a.localeCompare(b))
const key = createHash('sha256').update(JSON.stringify({ version: 2, app: relative(root, app), outDir, command, node: process.version, platform: process.platform, arch: process.arch, environment, source: hashFiles(root, buildInputs) })).digest('hex')
const fingerprint = (dir) => hashFiles(dir, walk(dir).filter((file) => relative(dir, file) !== marker))
const valid = (dir) => {
  try { return readFileSync(join(dir, marker), 'utf8') === `${key} ${fingerprint(dir)}` } catch { return false }
}
const cacheRoot = process.env.JUNO_BUILD_CACHE_DIR
const cached = cacheRoot && join(cacheRoot, relative(root, app).replaceAll('/', '-'), key)
const started = performance.now()
if (process.env.JUNO_REBUILD !== '1') {
  if (valid(output)) {
    console.log(`build-cached: ${outDir}/ is up to date; skipped ${JSON.stringify(command)}`)
    process.exit(0)
  }
  if (cached && valid(cached)) {
    try {
      rmSync(output, { recursive: true, force: true })
      cpSync(cached, output, { recursive: true })
      if (!valid(output)) throw new Error('output checksum mismatch')
      utimesSync(cached, new Date(), new Date())
      console.log(`build-cached: restored ${outDir}/ in ${((performance.now() - started) / 1000).toFixed(2)} s; skipped ${JSON.stringify(command)}`)
      process.exit(0)
    } catch (error) {
      // Another job may have pruned this entry. A cache miss must still build cleanly.
      console.log(`build-cached: restore missed (${error.message}); rebuilding`)
      rmSync(output, { recursive: true, force: true })
    }
  }
}
// A failed or partial build must never leave a passing stamp.
rmSync(join(output, marker), { force: true })
const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' })
if (result.status !== 0) process.exit(result.status ?? 1)
writeFileSync(join(output, marker), `${key} ${fingerprint(output)}`)
console.log(`build-cached: built ${outDir}/ in ${((performance.now() - started) / 1000).toFixed(2)} s`)
if (cached) {
  const parent = resolve(cached, '..')
  mkdirSync(parent, { recursive: true })
  const temporary = mkdtempSync(join(parent, '.building-'))
  try {
    cpSync(output, temporary, { recursive: true })
    // Entries are immutable. A concurrent writer of the same key can win.
    if (!valid(cached)) rmSync(cached, { recursive: true, force: true })
    try { renameSync(temporary, cached) } catch (error) {
      if (!valid(cached)) throw error
    }
  } finally { rmSync(temporary, { recursive: true, force: true }) }
  // Bound persistent storage to eight builds per app. Readers verify their private copy.
  const old = readdirSync(parent).filter((name) => /^[a-f0-9]{64}$/.test(name)).flatMap((name) => {
    const path = join(parent, name)
    try { return [{ path, at: statSync(path).mtimeMs }] } catch { return [] }
  }).toSorted((a, b) => b.at - a.at).slice(8)
  for (const { path } of old) if (path !== cached) rmSync(path, { recursive: true, force: true })
}

// Runs the unit tests: every package's `bun test` files in one
// `bun test --parallel` from the repo root, one process per file, at most
// JUNO_TEST_WORKERS at once (default half the cores), slowest files first by
// the last run's timings. The root bunfig.toml loads the shared preload.
// With --files <repo paths> last, runs only those files.
// Other arguments go to `bun test` (filters and flags).
import { spawn } from 'node:child_process'
import { existsSync, globSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import { unitTestMatcher } from './affected-tests.mjs'
import { forwardSignals } from './remote/children.mjs'

const runsBunTest = (root, dir) => /^bun test\b/.test(JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8')).scripts?.test ?? '')

/** The folder `bun test` searches in a package: its bunfig.toml `[test] root`, else the package. */
function testRoot(root, dir) {
  const config = resolve(root, dir, 'bunfig.toml')
  const configured = existsSync(config) ? /^\s*root\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1] : undefined
  return configured === undefined ? dir : join(dir, configured)
}

// Per checkout, so two worktrees never write one file at once.
const timingsFile = (root) => join(root, 'node_modules', '.cache', 'juno', 'bun-test-timings.json')

/** The `bun test` arguments for a run: every package, or the files after `--files`. */
export function unitCommand(args, root, { workers = defaultWorkers() } = {}) {
  const run = (paths, extra, count) => ['test', `--parallel=${count}`, `--timings=${timingsFile(root)}`, '--update-timings', ...extra, ...paths]
  const at = args.indexOf('--files')
  if (at === -1) {
    const { workspaces } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const dirs = globSync(workspaces.map((pattern) => `${pattern}/package.json`), { cwd: root }).map((file) => file.slice(0, -'/package.json'.length)).toSorted()
    // Filters given by name (`bun run test messages`) search every package; otherwise each package's test folder.
    const named = args.some((arg) => !arg.startsWith('-'))
    return run(named ? [] : dirs.filter((dir) => runsBunTest(root, dir)).map((dir) => `./${testRoot(root, dir)}`), args, workers)
  }
  const files = [...new Set(args.slice(at + 1))]
  if (files.length === 0) throw new Error('--files needs at least one repository test path')
  const matches = unitTestMatcher(root)
  for (const file of files) {
    if (file.split('/').some((part) => part === '..' || part === '.') || !matches(file) || !existsSync(resolve(root, file))) throw new Error(`Not a unit test file: ${file}`)
  }
  return run(files.map((file) => `./${file}`), args.slice(0, at), Math.min(workers, files.length))
}

function defaultWorkers() {
  const workers = Number(process.env.JUNO_TEST_WORKERS ?? Math.max(1, Math.floor(availableParallelism() / 2)))
  if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('JUNO_TEST_WORKERS must be a positive integer')
  return workers
}

if (import.meta.main) {
  // bun test refuses a timings file that is not JSON (a run stopped while writing it).
  const timings = timingsFile(process.cwd())
  mkdirSync(join(timings, '..'), { recursive: true })
  try { if (existsSync(timings)) JSON.parse(readFileSync(timings, 'utf8')) } catch { rmSync(timings) }
  const child = spawn('bun', unitCommand(process.argv.slice(2), process.cwd()), { stdio: 'inherit' })
  forwardSignals(new Set([child]))
  child.on('error', (error) => console.error(error.message))
  child.on('close', (code, signal) => { process.exitCode = signal ? 130 : code ?? 1 })
}

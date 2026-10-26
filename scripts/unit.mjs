// Runs the unit tests: every package's `bun test` files in one
// `bun test --parallel` from the repo root, at most JUNO_TEST_WORKERS worker
// processes at once (default half the cores). The root bunfig.toml loads the
// shared preload. With --files <repo paths> last, runs only those files.
//
// - Order: files, and the tests in each file, run in a shuffled order. The seed
//   is printed first; `--seed <n>` (or JUNO_TEST_SEED) repeats that order.
// - Isolation: a worker keeps one global and module registry across the files
//   it runs (--no-isolate). `--isolate` (or JUNO_TEST_ISOLATE=1) gives each
//   file a fresh one, for telling a leak between files from a fault in one.
//
// Other arguments go to `bun test` (filters and flags).
import { spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import { unitTestMatcher } from './affected-tests.mjs'
import { forwardSignals } from './remote/children.mjs'

// The default test timeout. The preload's setDefaultTimeout reaches only the
// first file a Bun process runs, so it is passed on the command line too.
// A stress run (JUNO_STRESS, scripts/remote/workers.sh) scales it with the load it adds.
const TIMEOUT_MS = 30_000 * Number(process.env.JUNO_STRESS_SCALE ?? 1)

const runsBunTest = (root, dir) => /^bun test\b/.test(JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8')).scripts?.test ?? '')

/** The folder `bun test` searches in a package: its bunfig.toml `[test] root`, else the package. */
function testRoot(root, dir) {
  const config = resolve(root, dir, 'bunfig.toml')
  const configured = existsSync(config) ? /^\s*root\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1] : undefined
  return configured === undefined ? dir : join(dir, configured)
}

/** The `bun test` arguments for a run (every package, or the files after `--files`) and its order seed. */
export function unitCommand(given, root, { workers = defaultWorkers() } = {}) {
  const { seed, rest } = takeSeed(given)
  const isolate = isolateFlag(rest)
  const args = rest.filter((arg) => arg !== '--isolate' && arg !== '--no-isolate' && arg !== '--randomize')
  const run = (paths, extra, count) => ({ seed, args: ['test', `--parallel=${count}`, isolate, `--seed=${seed}`, `--timeout=${TIMEOUT_MS}`, ...extra, ...paths] })
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

/** `--seed <n>` or `--seed=<n>` taken out of the arguments, else JUNO_TEST_SEED, else a new random seed. */
export function takeSeed(args) {
  const rest = []
  let given = process.env.JUNO_TEST_SEED || undefined
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--seed') given = args[++index]
    else if (args[index].startsWith('--seed=')) given = args[index].slice('--seed='.length)
    else rest.push(args[index])
  }
  if (given === undefined) return { seed: randomInt(1, 2 ** 32), rest }
  const seed = Number(given)
  if (!/^\d+$/.test(given) || seed >= 2 ** 32) throw new Error('The test seed must be an integer from 0 to 4294967295')
  return { seed, rest }
}

/** The last of --isolate and --no-isolate given, else JUNO_TEST_ISOLATE (1 or 0), else --no-isolate. */
function isolateFlag(args) {
  const given = args.findLast((arg) => arg === '--isolate' || arg === '--no-isolate')
  if (given !== undefined) return given
  const env = process.env.JUNO_TEST_ISOLATE
  if (env === undefined || env === '') return '--no-isolate'
  if (env !== '0' && env !== '1') throw new Error('JUNO_TEST_ISOLATE must be 0 or 1')
  return env === '1' ? '--isolate' : '--no-isolate'
}

function defaultWorkers() {
  const workers = Number(process.env.JUNO_TEST_WORKERS ?? Math.max(1, Math.floor(availableParallelism() / 2)))
  if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('JUNO_TEST_WORKERS must be a positive integer')
  return workers
}

if (import.meta.main) {
  const { seed, args } = unitCommand(process.argv.slice(2), process.cwd())
  console.log(`unit: test order seed ${seed}; \`bun run test --seed ${seed}\` repeats it`)
  const child = spawn('bun', args, { stdio: 'inherit' })
  forwardSignals(new Set([child]))
  child.on('error', (error) => console.error(error.message))
  child.on('close', (code, signal) => { process.exitCode = signal ? 130 : code ?? 1 })
}

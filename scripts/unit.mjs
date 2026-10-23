// Runs the unit tests. Every package whose `test` script is `bun test` runs in
// one `bun test --parallel` from the repo root: one process per file, at most
// JUNO_TEST_WORKERS at once (default half the cores), slowest files first by
// the last run's timings. A package with another test script runs that script,
// at most JUNO_TEST_PACKAGE_JOBS packages at a time beside it.
// With --files <repo paths>, runs only those files, the same way.
// Other arguments go to every command (`bun test` filters and flags).
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

function bunTest(root, paths, extra, workers) {
  return ['test', `--parallel=${workers}`, `--timings=${timingsFile(root)}`, '--update-timings', ...extra, ...paths]
}

export function unitCommands(args, root, { workers = defaultWorkers() } = {}) {
  if (args[0] !== '--files') {
    const { workspaces } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const dirs = globSync(workspaces.map((pattern) => `${pattern}/package.json`), { cwd: root }).map((file) => file.slice(0, -'/package.json'.length)).toSorted()
    const tested = dirs.filter((dir) => JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8')).scripts?.test)
    const bun = tested.filter((dir) => runsBunTest(root, dir))
    // Filters given by name (`bun run test messages`) search every package; otherwise each package's test folder.
    const named = args.some((arg) => !arg.startsWith('-'))
    return [
      ...(bun.length === 0 ? [] : [bunTest(root, named ? [] : bun.map((dir) => `./${testRoot(root, dir)}`), args, workers)]),
      ...tested.filter((dir) => !bun.includes(dir)).map((dir) => ['run', '--cwd', dir, 'test', ...args]),
    ]
  }
  if (args.length === 1) throw new Error('--files needs at least one repository test path')
  const matches = unitTestMatcher(root)
  const bunFiles = []
  const packages = new Map()
  for (const file of new Set(args.slice(1))) {
    if (file.split('/').some((part) => part === '..' || part === '.') || !matches(file) || !existsSync(resolve(root, file))) throw new Error(`Not a unit test file: ${file}`)
    const dir = file.split('/').slice(0, 2).join('/')
    if (runsBunTest(root, dir)) {
      bunFiles.push(`./${file}`)
      continue
    }
    if (!packages.has(dir)) packages.set(dir, [])
    packages.get(dir).push(resolve(root, file))
  }
  const candidates = [...globSync([...packages.keys()].map((dir) => `${dir}/**/*`), { cwd: root, exclude: ['**/node_modules/**'] })].filter(matches).map((file) => resolve(root, file))
  return [
    ...(bunFiles.length === 0 ? [] : [bunTest(root, bunFiles, [], Math.min(workers, bunFiles.length))]),
    ...[...packages].map(([dir, files]) => {
      // Vitest's filename filters use substrings, even for absolute paths.
      // Exclude namesakes in nested folders and files with a longer extension.
      const prefix = resolve(root, dir) + '/'
      const filters = files.map((file) => file.slice(prefix.length).toLowerCase())
      const extra = candidates.filter((file) => file.startsWith(prefix) && !files.includes(file) && filters.some((filter) => file.slice(prefix.length).toLowerCase().includes(filter)))
      return ['run', '--cwd', dir, 'test', ...files, ...extra.flatMap((file) => ['--exclude', file.slice(prefix.length)])]
    }),
  ]
}

function defaultWorkers() {
  const workers = Number(process.env.JUNO_TEST_WORKERS ?? process.env.JUNO_VITEST_WORKERS ?? Math.max(1, Math.floor(availableParallelism() / 2)))
  if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('JUNO_TEST_WORKERS must be a positive integer')
  return workers
}

if (import.meta.main) {
  const jobs = Number(process.env.JUNO_TEST_PACKAGE_JOBS ?? 2)
  if (!Number.isSafeInteger(jobs) || jobs < 1) throw new Error('JUNO_TEST_PACKAGE_JOBS must be a positive integer')
  const args = process.argv.slice(2)
  // bun test refuses a timings file that is not JSON (a run stopped while writing it).
  const timings = timingsFile(process.cwd())
  mkdirSync(join(timings, '..'), { recursive: true })
  try { if (existsSync(timings)) JSON.parse(readFileSync(timings, 'utf8')) } catch { rmSync(timings) }
  const commands = unitCommands(args, process.cwd())
  const children = new Set()
  forwardSignals(children)
  let cancelled = false
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { cancelled = true })
  const run = (command) => new Promise((done) => {
    const child = spawn('bun', command, { stdio: 'inherit' })
    children.add(child)
    child.on('error', (error) => console.error(error.message))
    child.on('close', (code) => { children.delete(child); done(code ?? 1) })
  })
  const codes = await Promise.all(Array.from({ length: Math.min(jobs, commands.length) }, async () => {
    let result = 0
    while (commands.length) {
      if (cancelled) break
      const code = await run(commands.shift())
      result ||= code
    }
    return result
  }))
  process.exitCode = cancelled ? 130 : codes.find((code) => code !== 0) ?? 0
}

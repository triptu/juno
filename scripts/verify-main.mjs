// The full run: every suite against main, in separate SSH jobs or locally,
// then a short summary.
//
//   pnpm verify:main                 local main
//   pnpm verify:main --local --dry-run  inspect the local plan without running it
//   pnpm verify:main --ref origin/main
//   pnpm verify:main --nightly         uncached Quint plus the Mac suites
//   pnpm verify:main --no-cache        rerun every Quint check
//   pnpm verify:main --with-mac      also, on this Mac: the e2e tests tagged @mac,
//                                    then `perf` and `test:feel`
//
// It checks main out into a temporary detached worktree, so nothing local is
// sent, and runs `test`, `specs:check` (Apalache cached; --no-cache or --nightly bypasses it),
// `specs:conformance`, `test:gallery` and `test:desktop` as one plan with independent SSH jobs
// (scripts/plan.mjs, through scripts/remote.mjs). The summary goes to
// shared .juno-status/verify-main.md and .json, each suite's lines
// to .juno-status/verify-main/<run>/<suite>.log. The exit code is 1 if any
// suite failed. perf and test:feel time the Mac, so they run only with
// --with-mac, one after the other, each holding the whole machine; the feel
// contact sheet is copied next to the logs.
//
// The desktop suite records coverage (JUNO_COVERAGE=1), and the run writes the
// coverage map pnpm affected selects specs by to
// apps/desktop/e2e/coverage-map.json in this checkout; commit it after a
// run on main (docs/development.md, "Affected tests").

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'
import { writeRecord } from './verify-records.mjs'
import { statusFolder } from './release-gate.mjs'
import { testResults } from './test-results-reporter.mjs'
import { planOutcomes } from './verify-plan.mjs'
import { scratchFolder } from './worktree-folder.mjs'
import { formatMap, MAP_PATH, mergePartials } from './coverage-map.mjs'
import { localVerifyEnv, verifyExecution } from './verify-execution.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const ref = argv.includes('--ref') ? argv[argv.indexOf('--ref') + 1] : 'main'
const withMac = argv.includes('--with-mac') || argv.includes('--nightly')
const noCache = argv.includes('--no-cache') || argv.includes('--nightly')
const execution = verifyExecution(argv.includes('--local'))
const local = execution.mode === 'local'

const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

const commit = git('rev-parse', ref)
const subject = git('log', '-1', '--format=%s', commit)
const runId = new Date().toISOString().replace(/[-:]/g, '').replace('.', '')
const statusDir = statusFolder(root)
const logDir = join(statusDir, 'verify-main', runId)
const suites = [
  { name: 'test', words: ['test'] },
  { name: 'specs:check', words: [...(noCache ? ['SPECS_CACHE=off'] : ['SPECS_RUN_CACHE=off']), 'specs:check', ...(noCache ? ['--no-cache'] : [])] },
  { name: 'specs:conformance', words: [...(noCache ? ['SPECS_CACHE=off'] : []), 'specs:conformance'] },
  { name: 'test:gallery', words: ['test:gallery'] },
  { name: 'test:desktop', words: ['JUNO_COVERAGE=1', 'test:desktop'] },
]

const words = suites.flatMap((suite, index) => [...(index ? ['+'] : []), ...suite.words])
if (argv.includes('--dry-run')) {
  console.log(`verify:main: ${commit} on ${execution.host} (${execution.mode}); no checkout, tests or record written`)
  if (local) console.log('pnpm install --frozen-lockfile; exclusive heavy lock; serial plan; desktop skips @mac')
  if (local) console.log(JSON.stringify(localVerifyEnv))
  console.log(`test:plan ${words.join(' ')}`)
  if (withMac) console.log('On this Mac: test:desktop --grep @mac, then perf, then test:feel (exclusive heavy lock)')
  process.exit(0)
}
mkdirSync(logDir, { recursive: true })
mkdirSync(scratchFolder(), { recursive: true })
const checkout = join(mkdtempSync(join(scratchFolder(), 'juno-verify-main-')), 'main')
git('worktree', 'add', '--detach', checkout, commit)
const removeCheckout = () => spawnSync('git', ['worktree', 'remove', '--force', checkout], { cwd: root, stdio: 'ignore' })
process.on('exit', removeCheckout)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130))

/** Runs one suite, writing its log; resolves with the outcome. */
function run(suite, command, args, cwd, env = {}) {
  return new Promise((resolvePromise) => {
    const started = Date.now()
    const log = join(logDir, `${suite.replace(/[^\w-]/g, '_')}.log`)
    const out = createWriteStream(log)
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(out)
    child.stderr.pipe(out)
    child.on('close', (code) => {
      out.end(() => resolvePromise({ suite, code: code ?? 1, seconds: Math.round((Date.now() - started) / 1000), log }))
    })
  })
}

/** Splits the plan's log into one log per suite, by each line's `[<script>] ` prefix, with the plan's own lines in every log. */
function splitPlan(planned) {
  let text = ''
  try { text = readFileSync(planned.log, 'utf8') } catch { /* The run left no log. */ }
  const lines = text.split('\n').map((line) => line.replace(/^\[runner:[^\]]+\] /, ''))
  const outcomes = planOutcomes(lines, suites, planned)
  return outcomes.map((outcome) => {
    if (outcome.suite === 'plan') return outcome
    const suite = suites.find((suite) => suite.name === outcome.suite)
    const prefix = `[${suite.name}] `
    const log = join(logDir, `${suite.name.replace(/[^\w-]/g, '_')}.log`)
    writeFileSync(log, lines.filter((line) => line.startsWith(prefix) || !line.startsWith('[')).map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line).join('\n'))
    return { ...outcome, log }
  })
}

console.log(`verify:main: ${commit.slice(0, 10)} ${subject}; ${execution.mode} on ${execution.host}`)
const heavy = join(checkout, 'scripts/heavy.mjs')
const planStarted = Date.now()
let installed = true
if (local) {
  installed = (await run('install', process.execPath, [heavy, '--exclusive', 'pnpm', 'install', '--frozen-lockfile', '--reporter=silent'], checkout)).code === 0
}
const runs = [!installed ? Promise.resolve(suites.map(({ name }) => ({ suite: name, code: 1, seconds: 0, log: join(logDir, 'install.log') })))
  : run('plan', process.execPath, local
    ? [heavy, '--exclusive', 'node', join(checkout, 'scripts/plan.mjs'), ...words]
    : [join(checkout, 'scripts/remote.mjs'), 'test:plan', ...words], checkout, local ? { ...localVerifyEnv, JUNO_SKIP_TAGS: '@mac' } : {}).then((planned) => splitPlan(planned))]
if (withMac) {
  // The @mac tests need the installed workspace and a build here; they take a heavy-job slot.
  runs.push(
    (async () => {
      // Local Electron suites share the checkout and must not overlap.
      if (local) await runs[0]
      const install = local ? { status: installed ? 0 : 1 } : spawnSync('pnpm', ['install', '--frozen-lockfile', '--reporter=silent'], { cwd: checkout, stdio: 'ignore' })
      if (install.status !== 0) return [{ suite: 'test:desktop @mac', code: 1, seconds: 0, log: '' }]
      return [await run('test:desktop @mac', 'pnpm', ['test:desktop', '--grep', '@mac'], checkout, local ? localVerifyEnv : {})]
    })(),
  )
}
let results = (await Promise.all(runs)).flat()

// The coverage map, from the partials this run's desktop machines brought back
// (scripts/coverage-map.mjs). A failed test still ran its code, so a failure
// does not stop the refresh; a spec with no partial is left out of the map and
// then always runs.
const coverageRoot = local ? join(checkout, 'apps/desktop/coverage/map') : join(checkout, '.remote')
const partials = existsSync(coverageRoot)
  ? readdirSync(coverageRoot, { recursive: true })
      .map((name) => join(coverageRoot, String(name)))
      .filter((path) => /apps\/desktop\/coverage\/map\/partial-[^/]*\.json$/.test(path) && statSync(path).mtimeMs >= planStarted)
  : []
let coverageNote = 'no coverage partials came back; the coverage map was not refreshed'
if (partials.length > 0) {
  const map = mergePartials(partials.map((path) => JSON.parse(readFileSync(path, 'utf8'))), commit)
  writeFileSync(join(root, MAP_PATH), formatMap(map))
  coverageNote = `coverage map refreshed from ${partials.length} partial(s): ${map.specs.length} spec file(s), ${Object.keys(map.files).length} source file(s); commit ${MAP_PATH}`
}
console.log(`verify:main: ${coverageNote}`)
if (withMac) {
  // After the rest, so they do not time a machine the other suites are using.
  for (const suite of ['perf', 'test:feel']) results = [...results, await run(suite, 'pnpm', [suite], checkout, local ? localVerifyEnv : {})]
  const sheet = join(checkout, 'apps/desktop/feel-report')
  if (existsSync(sheet)) cpSync(sheet, join(logDir, 'feel-report'), { recursive: true, force: true })
}

/** The failing tests a log names: Playwright's numbered failures, vitest's FAIL lines, a failed spec job. */
function failures(log) {
  let text = ''
  try {
    text = readFileSync(log, 'utf8')
  } catch {
    return []
  }
  const lines = text.split('\n').map((line) => line.replace(/^\[runner:[^\]]+\] /, ''))
  const found = [
    ...lines.filter((line) => /^\s+\d+\) /.test(line)).map((line) => line.trim().replace(/\s*─+$/, '')),
    ...lines.filter((line) => /^did not run: |against a budget of/.test(line)).map((line) => line.trim()),
    ...lines.filter((line) => /\bFAIL\b/.test(line) && /\.test\.ts/.test(line)).map((line) => line.replace(/^.*?FAIL\s+/, 'FAIL ').trim()),
    ...lines.filter((line) => /^Error: (Quint|Spec check|Missing|A corrected|Agent schedule|No usable)/.test(line)),
    ...lines.filter((line) => /^remote: (?!.*exited with)/.test(line) && /failed|lost the connection|not reach|unreachable|Gave up/.test(line)),
  ]
  return [...new Set(found)].slice(0, 20)
}

const summary = {
  commit,
  subject,
  ref,
  execution,
  finishedAt: new Date().toISOString(),
  passed: results.every((result) => result.code === 0),
  coverage: coverageNote,
  nightly: argv.includes('--nightly'),
  suites: results.map((result) => ({ ...result, host: suites.some(({ name }) => name === result.suite) || result.suite === 'plan' ? execution.host : hostname(), log: result.log ? join('.juno-status', relative(statusDir, result.log)) : '', failures: result.code === 0 ? [] : failures(result.log), tests: result.log && existsSync(result.log) ? testResults(readFileSync(result.log, 'utf8')) : undefined })),
}
writeRecord(statusDir, runId, summary)
const markdown = [
  `# verify:main ${summary.passed ? 'passed' : 'FAILED'}`,
  '',
  `${commit.slice(0, 10)} ${subject} (${ref}), finished ${summary.finishedAt}.`,
  '',
  `Full plan ran on ${execution.host} (${execution.mode}).`,
  '',
  `${coverageNote[0].toUpperCase()}${coverageNote.slice(1)}.`,
  '',
  '| Suite | Result | Time | Log |',
  '| --- | --- | --- | --- |',
  ...summary.suites.map((suite) => `| \`${suite.suite}\` | ${suite.code === 0 ? 'passed' : `failed (${suite.code})`} | ${suite.seconds} s | \`${suite.log}\` |`),
  '',
  ...summary.suites.flatMap((suite) => (suite.tests?.flaky ?? []).map((test) => `- FLAKY ${test.id}: ${test.title} (passed on retry)`)),
  ...summary.suites
    .filter((suite) => suite.failures.length > 0)
    .flatMap((suite) => ['', `## ${suite.suite}`, '', ...suite.failures.map((failure) => `- ${failure}`)]),
  '',
].join('\n')
writeFileSync(join(statusDir, 'verify-main.md'), markdown)
console.log(markdown)
process.exit(summary.passed ? 0 : 1)

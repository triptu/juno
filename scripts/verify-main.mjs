// The full run: every suite against main, in separate SSH jobs or locally,
// then a short summary.
//
//   bun run verify:main                 local main
//   bun run verify:main --local --dry-run  inspect the local plan without running it
//   bun run verify:main --ref origin/main
//   bun run verify:main --nightly         varied Quint seed, coverage and Mac suites
//   bun run verify:main --repair latest   repair a failed ancestor record
//   bun run verify:main --no-cache        rerun every Quint check
//   bun run verify:main --with-mac      also, on this Mac: the e2e tests tagged @mac,
//                                    then `perf` and `test:feel`
//
// It checks main out into a temporary detached worktree, so nothing local is
// sent, and runs `test`, `specs:check` (reused while its inputs match),
// `specs:conformance`, `test:gallery` and `test:desktop` as one plan with independent SSH jobs
// (scripts/plan.mjs, through scripts/remote.mjs). The summary goes to
// shared .juno-status/verify-main.md and .json, each suite's lines
// to .juno-status/verify-main/<run>/<suite>.log. The exit code is 1 if any
// suite failed. perf and test:feel time the Mac, so they run only with
// --with-mac, one after the other, each holding the whole machine; the feel
// contact sheet is copied next to the logs.
//
// The nightly desktop suite records coverage (JUNO_COVERAGE=1) and writes the
// coverage map bun run affected selects specs by to
// apps/desktop/e2e/coverage-map.json in this checkout; commit it after a
// run on main (docs/development.md, "Affected tests").

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomInt } from 'node:crypto'
import { hostname } from 'node:os'
import { writeRecord } from './verify-records.mjs'
import { isAncestor, readRecords, statusFolder } from './release-gate.mjs'
import { failureCause, testResults } from './test-results-reporter.mjs'
import { fullSuites, planOutcomes } from './verify-plan.mjs'
import { scratchFolder } from './worktree-folder.mjs'
import { formatMap, MAP_PATH, mergePartials } from './coverage-map.mjs'
import { localVerifyEnv, verifyExecution } from './verify-execution.mjs'
import { committedInputKey, protocolInputs, runtimeIdentity, sameIdentity } from './verify-inputs.mjs'
import { mergeRepairTests, repairPlan, suitePassed } from './verify-repair.mjs'
import { ImportGraph } from './import-graph.mjs'
import { keepReports } from './verify-reports.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const ref = argv.includes('--ref') ? argv[argv.indexOf('--ref') + 1] : 'main'
const withMac = argv.includes('--with-mac') || argv.includes('--nightly')
const nightly = argv.includes('--nightly')
const noCache = argv.includes('--no-cache')
const seed = process.env.SPECS_SEED ?? (nightly ? String(randomInt(1, 2 ** 32)) : undefined)

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
const failedSetup = (error) => {
  const message = error instanceof Error ? error.message : String(error)
  writeRecord(statusDir, runId, { version: 2, commit, subject, ref, finishedAt: new Date().toISOString(), passed: false,
    suites: [{ suite: 'setup', code: 1, seconds: 0, failures: [message], cause: { category: 'infrastructure', provisional: true, evidence: message } }] })
  console.error(`verify:main: ${message}`)
  process.exit(1)
}
process.on('uncaughtException', failedSetup)
process.on('unhandledRejection', failedSetup)
const execution = verifyExecution(argv.includes('--local'))
const local = execution.mode === 'local'
if (local && argv.includes('--require-remote')) throw new Error('This run requires the laptop; local fallback is disabled')
const identity = runtimeIdentity(root, !local)
const records = readRecords(statusDir)
const scripts = JSON.parse(git('show', `${commit}:package.json`)).scripts ?? {}
const required = fullSuites(scripts, { nightly, noCache, seed })
const repairArg = argv.includes('--repair') ? argv[argv.indexOf('--repair') + 1] : undefined
const baseline = repairArg === 'latest' ? records[0] : repairArg ? JSON.parse(readFileSync(resolve(repairArg), 'utf8')) : undefined
if (repairArg && (!baseline || baseline.version !== 2 || !isAncestor(root, baseline.commit, commit)))
  throw new Error('--repair needs a version 2 record at an ancestor of the target commit')
if (baseline && (nightly || noCache)) throw new Error('--repair cannot be combined with --nightly or --no-cache')
const tracked = git('ls-tree', '-r', '--name-only', commit).split('\n')
const protocolRoots = protocolInputs(tracked)
const reused = []
let suites = required.filter((suite) => {
  if (baseline || !protocolRoots[suite.name] || noCache || (seed !== undefined && suite.name === 'specs:check')) return true
  for (const record of records) {
    const previous = record.suites.find((item) => item.suite === suite.name)
    if (!previous || !suitePassed(previous) || !sameIdentity(previous.identity, identity) || !previous.inputs || !isAncestor(root, record.commit, commit)) continue
    if (!protocolRoots[suite.name].every((file) => previous.inputs.includes(file))) continue
    if (previous.inputKey !== committedInputKey(root, commit, previous.inputs, identity)) continue
    reused.push({ ...previous, reusedFrom: { commit: record.commit, finishedAt: record.finishedAt } })
    return false
  }
  return true
})
let words = suites.flatMap((suite, index) => [...(index ? ['+'] : []), ...suite.words])
if (argv.includes('--dry-run')) {
  console.log(`verify:main: ${commit} on ${execution.host} (${execution.mode}); no checkout, tests or record written`)
  if (local) console.log('bun install --frozen-lockfile; exclusive heavy lock; serial plan; desktop skips @mac')
  if (local) console.log(JSON.stringify(localVerifyEnv))
  console.log(`test:plan ${words.join(' ')}`)
  for (const suite of reused) console.log(`Reuse ${suite.suite}: unchanged inputs and runtime (${suite.reusedFrom.commit})`)
  if (baseline) console.log(`Repair ${baseline.commit}: failed/unfinished files plus uncapped import-graph selection (resolved in the target checkout)` )
  if (withMac) console.log('On this Mac: test:desktop --grep @mac, then perf, then test:feel (exclusive heavy lock)')
  process.exit(0)
}
mkdirSync(logDir, { recursive: true })
mkdirSync(scratchFolder(), { recursive: true })
const checkout = join(mkdtempSync(join(scratchFolder(), 'juno-verify-main-')), 'main')
git('worktree', 'add', '--detach', checkout, commit)
const removeCheckout = () => spawnSync('git', ['worktree', 'remove', '--force', checkout], { cwd: root, stdio: 'ignore' })
process.on('exit', removeCheckout)
const children = new Set()
let cancelled
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { cancelled = signal; for (const child of children) child.kill(signal) })

/** Runs one suite, writing its log; resolves with the outcome. */
function run(suite, command, args, cwd, env = {}) {
  return new Promise((resolvePromise) => {
    if (cancelled) { resolvePromise({ suite, code: 130, signal: cancelled, seconds: 0, log: '' }); return }
    const started = Date.now()
    const log = join(logDir, `${suite.replace(/[^\w-]/g, '_')}.log`)
    const out = createWriteStream(log)
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    children.add(child)
    child.on('error', (error) => out.write(`${error.message}\n`))
    child.stdout.pipe(out)
    child.stderr.pipe(out)
    child.on('close', (code, signal) => {
      children.delete(child)
      out.end(() => resolvePromise({ suite, code: code ?? (signal ? 130 : 1), signal, seconds: Math.round((Date.now() - started) / 1000), log }))
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

const checkoutFiles = tracked.filter((file) => /^(apps|packages)\//.test(file))
const graph = new ImportGraph(checkout, new Set(checkoutFiles))
const protocols = protocolInputs(tracked, (file) => graph.closure(file))
let affected
if (baseline) {
  // The graph is deliberately broader than coverage: a repair has no sampling or heavy exclusions.
  const selected = spawnSync(process.execPath, [join(checkout, 'scripts/affected.mjs'), '--plan', '--json', '--wide', '--graph', '--no-cache', '--range', `${baseline.commit}..${commit}`, ...(local ? ['--local'] : [])], { cwd: checkout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (selected.status !== 0) throw new Error(`Could not plan repair: ${selected.stderr}`)
  affected = JSON.parse(selected.stdout)
  const repair = repairPlan({ baseline, identity, suites: required, affected: affected.steps })
  suites = repair.planned
  reused.push(...repair.reused)
  words = suites.flatMap((suite, index) => [...(index ? ['+'] : []), ...suite.words])
}

console.log(`verify:main: ${commit.slice(0, 10)} ${subject}; ${execution.mode} on ${execution.host}`)
const heavy = join(checkout, 'scripts/heavy.mjs')
const planStarted = Date.now()
let installed = true
if (local) {
  installed = (await run('install', process.execPath, [heavy, '--exclusive', 'bun', 'install', '--frozen-lockfile', '--silent'], checkout)).code === 0
}
const runs = [cancelled || !installed ? Promise.resolve(suites.map(({ name }) => ({ suite: name, code: cancelled ? 130 : 1, seconds: 0, log: join(logDir, 'install.log') })))
  : suites.length === 0 ? Promise.resolve([]) : run('plan', process.execPath, local
    ? [heavy, '--exclusive', 'node', join(checkout, 'scripts/plan.mjs'), ...words]
    : [join(checkout, 'scripts/remote.mjs'), 'test:plan', ...words], checkout, local ? { ...localVerifyEnv, JUNO_SKIP_TAGS: '@mac' } : {}).then((planned) => splitPlan(planned))]
if (withMac) {
  // The @mac tests need the installed workspace and a build here; they take a heavy-job slot.
  runs.push(
    (async () => {
      // Local Electron suites share the checkout and must not overlap.
      if (local) await runs[0]
      if (cancelled) return [{ suite: 'test:desktop @mac', code: 130, seconds: 0, log: '' }]
      const install = local ? { status: installed ? 0 : 1 } : spawnSync('bun', ['install', '--frozen-lockfile', '--silent'], { cwd: checkout, stdio: 'ignore' })
      if (install.status !== 0) return [{ suite: 'test:desktop @mac', code: 1, seconds: 0, log: '' }]
      return [await run('test:desktop @mac', 'bun', ['run', 'test:desktop', '--grep', '@mac'], checkout, local ? localVerifyEnv : {})]
    })(),
  )
}
let results = (await Promise.all(runs)).flat()

// The coverage map, from the partials this run's desktop machines brought back
// (scripts/coverage-map.mjs). A failed test still ran its code, so a failure
// does not stop the refresh; a spec with no partial is left out of the map and
// then always runs.
const coverageRoot = local ? join(checkout, 'apps/desktop/coverage/map') : join(checkout, '.remote')
const partials = nightly && existsSync(coverageRoot)
  ? readdirSync(coverageRoot, { recursive: true })
      .map((name) => join(coverageRoot, String(name)))
      .filter((path) => /apps\/desktop\/coverage\/map\/partial-[^/]*\.json$/.test(path) && statSync(path).mtimeMs >= planStarted)
  : []
let coverageNote = nightly ? 'no coverage partials came back; the coverage map was not refreshed' : 'coverage recording is nightly only'
if (partials.length > 0) {
  const map = mergePartials(partials.map((path) => JSON.parse(readFileSync(path, 'utf8'))), commit)
  map.identity = identity
  writeFileSync(join(root, MAP_PATH), formatMap(map))
  coverageNote = `coverage map refreshed from ${partials.length} partial(s): ${map.specs.length} spec file(s), ${Object.keys(map.files).length} source file(s); commit ${MAP_PATH}`
}
console.log(`verify:main: ${coverageNote}`)
if (withMac && !cancelled) {
  // After the rest, so they do not time a machine the other suites are using.
  for (const suite of ['perf', 'test:feel']) results = [...results, await run(suite, 'bun', ['run', suite], checkout, local ? localVerifyEnv : {})]
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

const measured = results.map((result) => {
  const log = result.log && existsSync(result.log) ? readFileSync(result.log, 'utf8') : ''
  const reported = [...log.matchAll(/^juno-runtime: (.+)$/gm)].map((match) => JSON.parse(match[1]))
  const expected = suites.some(({ name }) => name === result.suite) || result.suite === 'plan' ? identity : runtimeIdentity(root)
  const actual = reported[0] ?? (local || expected !== identity ? expected : undefined)
  const mismatch = actual === undefined || reported.some((value) => !sameIdentity(value, expected))
  let code = cancelled ? 130 : mismatch ? 1 : result.code
  let tests = testResults(log)
  if (baseline && tests) tests = mergeRepairTests(baseline.suites.find((suite) => suite.suite === result.suite)?.tests, tests)
  if (!suitePassed({ ...result, code, tests })) code ||= 1
  const inputs = protocols[result.suite]
  const override = argv.filter((word, index) => argv[index - 1] === '--cause').map((word) => word.split('=')).find(([suite]) => suite === result.suite)?.[1]
  return { ...result, code, command: suites.find(({ name }) => name === result.suite)?.words, identity: actual, inputs, inputKey: inputs ? committedInputKey(root, commit, inputs, actual) : undefined,
    host: suites.some(({ name }) => name === result.suite) || result.suite === 'plan' ? execution.host : hostname(),
    log: result.log ? join('.juno-status', relative(statusDir, result.log)) : '',
    failures: code === 0 ? [] : mismatch ? ['The job runtime differs from the planned runtime; reuse was refused'] : failures(result.log), tests,
    cause: failureCause({ code, signal: cancelled ?? result.signal, tests, log, cause: override }),
  }
})
const outcomes = [...measured, ...reused]
const summary = {
  version: 2, commit, subject, ref, identity, execution,
  finishedAt: new Date().toISOString(),
  passed: !cancelled && outcomes.every(suitePassed),
  required: required.map((suite) => suite.name),
  repair: baseline ? { commit: baseline.commit, finishedAt: baseline.finishedAt, selection: 'graph-uncapped', changed: affected.changed, steps: affected.steps } : undefined,
  coverage: coverageNote, nightly, seed,
  suites: outcomes,
  seconds: (Date.now() - planStarted) / 1000,
  allocation: Object.fromEntries(['DESKTOP', 'GALLERY', 'UNIT', 'SPECS'].map((kind) => [kind.toLowerCase(), process.env[`JUNO_RUNNER_${kind}_CORES`] ?? 'default'])),
  reports: keepReports(checkout, logDir, planStarted).map((file) => join('.juno-status', relative(statusDir, file))),
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

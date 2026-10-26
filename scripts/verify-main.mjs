// The full run: every suite against main, in separate SSH jobs or locally,
// then a short summary.
//
//   bun run verify:main                 local main
//   bun run verify:main --local --dry-run  inspect the local plan without running it
//   bun run verify:main --ref origin/main
//   bun run verify:main --repair latest   repair a failed ancestor record
//   bun run verify:main --no-cache        run every test file fresh, rerun every spec check, regenerate the conformance traces and walk every gallery state
//   bun run verify:main --priority high   take laptop cores before waiting normal jobs (a release does this)
//   bun run verify:main --with-mac      also, on this Mac: the e2e tests tagged @mac,
//                                    then `test:feel`
//
// A full run runs every test, the @heavy ones included (scripts/test-areas.mjs),
// and is what a release needs. It checks main out into a temporary detached
// worktree, so nothing local is sent. The unit, DOM, browser and Electron lanes run the test files whose inputs
// changed since an earlier green full run and a fresh 20% sample of the others, and reuse the rest's passes; every
// file runs when the last fully fresh run is a week old or with --no-cache (scripts/verify-files.mjs). It runs `test`, `test:dom`, `specs:check`
// (each check reused while its inputs match), `specs:conformance` (traces reused
// while their spec, seed and Quint version match; the replay always runs),
// `test:gallery` (the fast check over the states whose walk-cache key changed and a fresh 5% sample of the
// rest, or over every state when the last uncached walk is a week old or with --no-cache) and the browser and Electron
// lanes as one plan with independent SSH jobs
// (scripts/plan.mjs, through scripts/remote.mjs). The summary goes to
// shared .juno-status/verify-main.md and .json, each suite's lines
// to .juno-status/verify-main/<run>/<suite>.log. The exit code is 1 if any
// suite failed. Timed perf is not part of a full run: it runs on demand
// (`bun run perf`, docs/performance.md 7.3). On the Mac, test:feel runs only
// with --with-mac, after the @mac tests, holding the whole machine; with the
// plan on the laptop it starts when the plan does. The feel contact sheet is copied next to the logs.

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomInt } from 'node:crypto'
import { createInterface } from 'node:readline'
import { hostname } from 'node:os'
import { reportedRuntime, writeRecord } from './verify-records.mjs'
import { assessRecord, isAncestor, readRecords, skippedTests, statusFolder } from './release-gate.mjs'
import { failureCause, testResults } from './test-results-reporter.mjs'
import { describeGalleryCounts, fullSuites, galleryCounts, galleryWalk, planOutcomes } from './verify-plan.mjs'
import { scratchFolder } from './worktree-folder.mjs'
import { localVerifyEnv, verifyExecution } from './verify-execution.mjs'
import { committedInputKey, protocolInputs, runtimeIdentity, sameIdentity } from './verify-inputs.mjs'
import { checkToolchain, fileResults, FILE_SAMPLE_SHARE, freshFileRun, laneFiles, timedFiles } from './verify-files.mjs'
import { fullRunCores, fullRunJobs } from './remote/plan.mjs'
import { mergeRepairTests, repairPlan, suitePassed } from './verify-repair.mjs'
import { ImportGraph } from './import-graph.mjs'
import { keepReports } from './verify-reports.mjs'
import { failures, stopFromLog } from './verify-failures.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const ref = argv.includes('--ref') ? argv[argv.indexOf('--ref') + 1] : 'main'
const withMac = argv.includes('--with-mac')
const smoke = argv.includes('--smoke')
if (smoke && ['--repair', '--with-mac'].some((flag) => argv.includes(flag))) throw new Error('--smoke cannot repair a full run or run Mac suites')
const noCache = argv.includes('--no-cache')
// --priority high (or JUNO_PRIORITY=high) puts the laptop jobs ahead of waiting normal ones; remote.mjs reads the env.
if (argv.includes('--priority')) process.env.JUNO_PRIORITY = argv[argv.indexOf('--priority') + 1]
if (![undefined, '', 'normal', 'high'].includes(process.env.JUNO_PRIORITY)) throw new Error('--priority and JUNO_PRIORITY take normal or high')
// Every spec simulation that runs takes a fresh seed, kept in the record: `bun run specs:check --seed <n>` repeats it.
const seed = process.env.SPECS_SEED ?? String(randomInt(1, 2 ** 32))
// The unit tests' shuffled order, kept in the record: `bun run test --seed <n>` repeats it.
const testSeed = process.env.JUNO_TEST_SEED || String(randomInt(1, 2 ** 32))

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
  writeRecord(statusDir, runId, { version: 2, commit, subject, ref, smoke, finishedAt: new Date().toISOString(), passed: false,
    suites: [{ suite: 'setup', code: 1, seconds: 0, failures: [message], cause: { category: 'infrastructure', provisional: true, evidence: message } }] })
  console.error(`verify:main: ${message}`)
  process.exit(1)
}
process.on('uncaughtException', failedSetup)
process.on('unhandledRejection', failedSetup)
const execution = verifyExecution(argv.includes('--local'))
const local = execution.mode === 'local'
if (local && argv.includes('--require-remote')) throw new Error('This run requires the laptop; local fallback is disabled')
const plannedIdentity = runtimeIdentity(root, !local)
const records = readRecords(statusDir)
const scripts = JSON.parse(git('show', `${commit}:package.json`)).scripts ?? {}
// The gallery reuses the walk records of unchanged states and walks this seed's sample of them again, unless the
// last uncached walk is over a week old or --no-cache asks for one (galleryWalk).
const gallery = galleryWalk(records, { noCache })
const gallerySample = gallery.uncached ? undefined : process.env.GALLERY_SAMPLE || String(randomInt(1, 2 ** 32))
const required = smoke ? [{ name: 'test', words: ['test', `--seed=${testSeed}`, '--files', 'packages/domain/test/title.test.ts'] }]
  : fullSuites(scripts, { noCache, seed, testSeed, skipTags: local ? ['@mac'] : [], gallerySample, gallerySource: `full-run:${commit.slice(0, 10)}:${runId}` })
const galleryPlan = gallery.uncached ? `every state uncached (${gallery.reason})`
  : `states whose walk-cache key changed, plus sample seed ${gallerySample} of the rest (last uncached walk ${gallery.last})`
// The test files of the unit, DOM, browser and Electron lanes reuse their passes from earlier green full runs while
// their inputs are unchanged, and this seed's 20% of those run again; every file runs when the last fully fresh run
// is over a week old or with --no-cache (freshFileRun).
let filesFresh = freshFileRun(records, { noCache })
const fileSample = filesFresh.fresh ? undefined : process.env.JUNO_FILE_SAMPLE || String(randomInt(1, 2 ** 32))
const filePlan = () => filesFresh.fresh ? `every file fresh (${filesFresh.reason})` : `changed files, plus sample seed ${fileSample} of the rest (last fully fresh run ${filesFresh.last})`
const repairArg = argv.includes('--repair') ? argv[argv.indexOf('--repair') + 1] : undefined
const baseline = repairArg === 'latest' ? records[0] : repairArg ? JSON.parse(readFileSync(resolve(repairArg), 'utf8')) : undefined
if (repairArg && (!baseline || baseline.version !== 2 || !isAncestor(root, baseline.commit, commit)))
  throw new Error('--repair needs a version 2 record at an ancestor of the target commit')
if (baseline && skippedTests(baseline)) throw new Error('--repair cannot start from a run that skipped tests; start a full run')
if (baseline && noCache) throw new Error('--repair cannot be combined with --no-cache')
// Reuse is provisional until this run's jobs confirm the recorded identity.
const identity = local ? plannedIdentity : baseline?.identity ?? records.find((record) =>
  record.execution?.mode === execution.mode && record.execution.host === execution.host && record.suites.some(suitePassed))?.identity ?? plannedIdentity
const tracked = git('ls-tree', '-r', '--name-only', commit).split('\n')
const protocolRoots = protocolInputs(tracked)
const reused = []
let suites = required.filter((suite) => {
  // Only the spec check is reused from an earlier run: it proves the models, not the code. Conformance replays its
  // traces against the engine, so it always runs. The spec seed is always set, and not part of any key.
  if (baseline || suite.name !== 'specs:check' || !protocolRoots[suite.name] || noCache) return true
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
mkdirSync(scratchFolder(), { recursive: true })
const checkout = join(mkdtempSync(join(scratchFolder(), 'juno-verify-main-')), 'main')
git('worktree', 'add', '--detach', checkout, commit)
const removeCheckout = () => spawnSync('git', ['worktree', 'remove', '--force', checkout], { cwd: root, stdio: 'ignore' })
process.on('exit', removeCheckout)

// Each lane's files: which run because they changed or were sampled, and which reuse a pass, keyed in the checkout.
// A pass is reused only from a run whose jobs reported this runtime and the toolchain the last run on this host did;
// the jobs confirm both when they start.
const runLabel = `${commit.slice(0, 10)}:${runId}`
let toolchain = records.find((record) => record.toolchain && record.execution?.mode === execution.mode && record.execution.host === execution.host)?.toolchain
const lanes = await laneFiles({ root, checkout, commit, tracked, suites: smoke || baseline ? [] : suites, records, identity, label: runLabel })
const planLanes = () => lanes.plan({ toolchain, fresh: filesFresh.fresh, seed: fileSample })
planLanes()
const fileReused = () => lanes.reused()
// Jobs shrink to the work left once files are reused (fullRunCores); a core count set by hand wins.
const layout = local || smoke || baseline ? undefined : gallery.uncached ? fullRunJobs.everyState : fullRunJobs.sampled
const sizing = () => layout && !filesFresh.fresh ? Object.fromEntries(Object.entries(fullRunCores(layout, lanes.shares()))
  .map(([kind, count]) => [`JUNO_RUNNER_${kind.toUpperCase()}_CORES`, process.env[`JUNO_RUNNER_${kind.toUpperCase()}_CORES`] ?? String(count)])) : {}
let words = suites.flatMap((suite, index) => [...(index ? ['+'] : []), ...suite.words])
const describePlan = () => lanes.describe()
if (argv.includes('--dry-run')) {
  console.log(`verify:main: ${commit} on ${execution.host} (${execution.mode}); a temporary checkout, no tests or record written`)
  if (local) console.log('bun install --frozen-lockfile; exclusive heavy lock; serial plan; desktop skips @mac')
  if (local) console.log(JSON.stringify(localVerifyEnv))
  console.log(`test:plan ${words.join(' ')}`)
  for (const suite of reused) console.log(`Reuse ${suite.suite}: unchanged inputs and runtime (${suite.reusedFrom.commit})`)
  if (!smoke && !baseline) console.log(`Gallery: ${galleryPlan}`)
  if (lanes.count > 0) console.log(`Test files: ${filePlan()}`)
  for (const line of describePlan()) console.log(`  ${line}`)
  if (Object.keys(sizing()).length > 0) console.log(`Jobs: ${Object.entries(sizing()).map(([key, value]) => `${key}=${value}`).join(' ')}`)
  if (baseline) console.log(`Repair ${baseline.commit}: failed/unfinished files plus uncapped import-graph selection (resolved in the target checkout)` )
  if (withMac) console.log('On this Mac: test:desktop --grep @mac, then test:feel (exclusive heavy lock)')
  process.exit(0)
}
mkdirSync(logDir, { recursive: true })
const children = new Set()
let cancelled
let liveIdentity
let liveToolchain
let toolchainChanged
let runtimeFailure
let setupFailure
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
    if (suite === 'plan') for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', (line) => {
      const event = line.replace(/^\[runner:[^\]]+\] /, '').replace(/^\[[^\]]+\] /, '')
      const stop = stopFromLog(event)
      // A job stopped for a changed toolchain reports its unfinished steps as setup failures; the run starts again instead.
      if (stop?.scope === 'run' && !setupFailure && !toolchainChanged) {
        setupFailure = stop
        console.error(`verify:main: ${stop.rule}: ${stop.signature}; stopped every job`)
        child.kill('SIGTERM')
      }
      // Reused passes ran on another toolchain: stop, and run every file again on this one (runPlan).
      const tools = !runtimeFailure && !toolchainChanged ? checkToolchain(line, { live: liveToolchain, expected: toolchain, reused: fileReused() }) : undefined
      if (tools) {
        ({ live: liveToolchain, failure: runtimeFailure, changed: toolchainChanged } = tools)
        if (tools.failure || tools.changed) console.error(`verify:main: ${tools.failure ?? `the toolchain changed since the reused passes (${tools.fields.join(', ')}); stopping to run every file fresh`}`)
        if (tools.failure || tools.changed) child.kill('SIGTERM')
      }
      const report = /^(?:\[runner:[^\]]+\] )?(?:\[[^\]]+\] )?juno-runtime: (.+)$/.exec(line)
      if (!report || runtimeFailure || toolchainChanged) return
      const checked = reportedRuntime(`juno-runtime: ${report[1]}`, undefined, [...reused.map((suite) => suite.identity), ...(fileReused() ? [identity] : []), ...(liveIdentity ? [liveIdentity] : [])], baseline?.identity)
      liveIdentity ??= checked.identity
      if (!checked.mismatch) return
      runtimeFailure = 'Job runtimes disagree with this run or its reused results; stopped every job'
      console.error(`verify:main: ${runtimeFailure}`)
      child.kill('SIGTERM')
    })
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
    writeFileSync(log, lines.filter((line) => line.startsWith(prefix) || (!line.startsWith('[') && !line.startsWith('juno-runtime:'))).map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line).join('\n'))
    return { ...outcome, log }
  })
}

console.log(`verify:main: ${commit.slice(0, 10)} ${subject}; ${execution.mode} on ${execution.host}`)
if (!smoke && !baseline) console.log(`verify:main: gallery walks ${galleryPlan}`)
if (lanes.count > 0) for (const line of [`test files: ${filePlan()}`, ...describePlan()]) console.log(`verify:main: ${line}`)
const heavy = join(checkout, 'scripts/heavy.mjs')
const planStarted = Date.now()
let installed = true
if (local || baseline) {
  installed = (await run('install', process.execPath, [heavy, '--exclusive', 'bun', 'install', '--frozen-lockfile', '--silent'], checkout)).code === 0
}
if (baseline && !installed) throw new Error(`Repair dependencies did not install; see ${join(logDir, 'install.log')}`)

const checkoutFiles = tracked.filter((file) => /^(apps|packages)\//.test(file))
const graph = new ImportGraph(checkout, new Set(checkoutFiles))
const protocols = protocolInputs(tracked, (file) => graph.closure(file))
let affected
if (baseline) {
  // A repair plans wide: no sampling or heavy exclusions.
  const selected = spawnSync(process.execPath, [join(checkout, 'scripts/affected.mjs'), '--plan', '--json', '--wide', '--no-cache', '--range', `${baseline.commit}..${commit}`, ...(local ? ['--local'] : [])], { cwd: checkout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, JUNO_TEST_SEED: testSeed } })
  if (selected.status !== 0) throw new Error(`Could not plan repair: ${selected.stderr}`)
  affected = JSON.parse(selected.stdout)
  const repair = repairPlan({ baseline, identity, suites: required, affected: affected.steps })
  suites = repair.planned
  reused.push(...repair.reused)
  words = suites.flatMap((suite, index) => [...(index ? ['+'] : []), ...suite.words])
}

// A full run or a release's repair waits for laptop cores as long as a split plan does, even when its steps form one job.
const runnerWait = Number(process.env.JUNO_RUNNER_WAIT ?? 3600)
const runOnce = () => run('plan', process.execPath, local
  ? [heavy, '--exclusive', process.execPath, join(checkout, 'scripts/plan.mjs'), ...words]
  : [join(checkout, 'scripts/remote.mjs'), '--wait', String(runnerWait), '--env', 'JUNO_VERIFY_POLICY=1', 'test:plan', ...words], checkout, local ? { ...localVerifyEnv, JUNO_SKIP_TAGS: '@mac', JUNO_VERIFY_POLICY: '1' } : sizing())
const runPlan = async () => {
  const planned = await runOnce()
  if (!toolchainChanged || cancelled || runtimeFailure || setupFailure) return planned
  // Once, with every file fresh: the toolchain the jobs reported is the one this run's passes are for.
  toolchain = toolchainChanged
  toolchainChanged = undefined
  liveToolchain = undefined
  filesFresh = { fresh: true, reason: 'the toolchain changed since the reused passes' }
  planLanes()
  words = suites.flatMap((suite, index) => [...(index ? ['+'] : []), ...suite.words])
  console.log(`verify:main: test files: ${filePlan()}`)
  return runOnce()
}
const runs = [cancelled || !installed ? Promise.resolve(suites.map(({ name }) => ({ suite: name, code: cancelled ? 130 : 1, seconds: 0, log: join(logDir, 'install.log') })))
  : suites.length === 0 ? Promise.resolve([]) : runPlan().then((planned) => splitPlan(planned))]
if (withMac) {
  // The @mac tests need the installed workspace and a build here; they take a heavy-job slot.
  runs.push(
    (async () => {
      // Local Electron suites share the checkout and must not overlap.
      if (local) await runs[0]
      if (cancelled) return [{ suite: 'test:desktop @mac', code: 130, seconds: 0, log: '' }]
      const install = local ? { status: installed ? 0 : 1 } : spawnSync('bun', ['install', '--frozen-lockfile', '--silent'], { cwd: checkout, stdio: 'ignore' })
      if (install.status !== 0) return [{ suite: 'test:desktop @mac', code: 1, seconds: 0, log: '' }]
      const mac = [await run('test:desktop @mac', 'bun', ['run', 'test:desktop', '--grep', '@mac'], checkout, local ? localVerifyEnv : {})]
      // feel films this Mac, so it follows its @mac tests; with the plan on the laptop it need not wait for it.
      if (!local) mac.push(await run('test:feel', 'bun', ['run', 'test:feel'], checkout))
      return mac
    })(),
  )
}
let results = (await Promise.all(runs)).flat()
const readLog = (result) => result.log && existsSync(result.log) ? readFileSync(result.log, 'utf8') : ''
const runtime = reportedRuntime(results.filter((result) => suites.some(({ name }) => name === result.suite) || result.suite === 'plan').map(readLog).join('\n'), local || suites.length === 0 ? identity : undefined, [...reused.map((suite) => suite.identity), ...(fileReused() ? [identity] : [])], baseline?.identity)

if (withMac && !cancelled) {
  // A local plan ran on this Mac too: feel waits for it, so it does not film a machine the other suites are using.
  if (local) results = [...results, await run('test:feel', 'bun', ['run', 'test:feel'], checkout, localVerifyEnv)]
  const sheet = join(checkout, 'apps/desktop/feel-report')
  if (existsSync(sheet)) cpSync(sheet, join(logDir, 'feel-report'), { recursive: true, force: true })
}

const measured = results.map((result) => {
  const log = readLog(result)
  const inPlan = suites.some(({ name }) => name === result.suite) || result.suite === 'plan'
  const checked = inPlan ? reportedRuntime(log, local ? identity : undefined, [runtime.identity]) : reportedRuntime(log, runtimeIdentity(root))
  const actual = checked.identity
  const mismatch = checked.mismatch || (inPlan && (runtime.mismatch || Boolean(runtimeFailure)))
  const stop = stopFromLog(log) ?? (result.code !== 0 || result.unfinished ? setupFailure : undefined)
  let code = cancelled && result.code !== 0 ? 130 : mismatch || stop ? 1 : result.code
  let tests = testResults(log)
  if (baseline && tests) tests = mergeRepairTests(baseline.suites.find((suite) => suite.suite === result.suite)?.tests, tests)
  if (!suitePassed({ ...result, code, tests })) code ||= 1
  const walks = result.suite === 'test:gallery' ? galleryCounts(log) : undefined
  const missed = [...walks?.states.missed ?? [], ...walks?.tests.missed ?? []]
  const ownFiles = lanes.files[result.suite]
  const ran = ownFiles ? fileResults(log, tests) : undefined
  const missedFiles = ownFiles && code !== 0 ? [...ran.failing].filter((file) => ownFiles.entries[file]?.ran === 'sampled') : []
  const inputs = protocols[result.suite]
  const override = argv.filter((word, index) => argv[index - 1] === '--cause').map((word) => word.split('=')).find(([suite]) => suite === result.suite)?.[1]
  return { ...result, code, stop, command: suites.find(({ name }) => name === result.suite)?.words, identity: actual, inputs, inputKey: inputs && actual ? committedInputKey(root, commit, inputs, actual) : undefined,
    host: suites.some(({ name }) => name === result.suite) || result.suite === 'plan' || result.suite === 'perf' ? execution.host : hostname(),
    log: result.log ? join('.juno-status', relative(statusDir, result.log)) : '',
    failures: code === 0 ? [] : stop ? [`${stop.rule}: ${stop.signature ?? `${stop.failed}/${stop.completed} tests failed`}`] : mismatch ? ['Job runtimes are missing or disagree with this run or its reused results; reuse was refused']
      : [...missed.length ? [`Sampled gallery records failed, so the walk-cache key missed an input: ${missed.join(', ')}`] : [],
        ...missedFiles.length ? [`Sampled reused test files failed, so the reuse key missed an input: ${missedFiles.join(', ')}`] : [], ...failures(result.log)], tests, walks, files: timedFiles(ownFiles, ran?.seconds),
    cause: failureCause({ code, signal: cancelled ?? result.signal, tests, unfinished: result.unfinished, log, cause: override ?? (mismatch || stop ? 'infrastructure' : undefined), note: stop ? JSON.stringify(stop) : mismatch ? 'The job must report the same runtime identity as this run and its reused results' : undefined }),
  }
})
const outcomes = [...measured, ...reused]
const summary = {
  version: 2, commit, subject, ref, identity: runtime.identity, plannedIdentity, execution, smoke,
  finishedAt: new Date().toISOString(),
  passed: !cancelled && !setupFailure && !runtimeFailure && !runtime.mismatch && outcomes.every(suitePassed),
  cause: cancelled ? failureCause({ code: 130, signal: cancelled }) : undefined,
  required: required.map((suite) => suite.name),
  repair: baseline ? { commit: baseline.commit, finishedAt: baseline.finishedAt, selection: 'graph-uncapped', changed: affected.changed, steps: affected.steps } : undefined,
  seed, testSeed, gallerySample,
  // A repair keeps its baseline's file reuse, dated from the baseline, so a repaired fresh run still counts as one.
  fileReuse: baseline ? baseline.fileReuse && { ...baseline.fileReuse, at: baseline.fileReuse.at ?? baseline.finishedAt }
    : lanes.count > 0 ? { fresh: filesFresh.fresh, reason: filesFresh.reason, last: filesFresh.last, sample: fileSample, share: FILE_SAMPLE_SHARE } : undefined,
  toolchain: liveToolchain ?? (local ? toolchain : undefined),
  suites: outcomes,
  seconds: (Date.now() - planStarted) / 1000,
  allocation: Object.fromEntries(['DESKTOP', 'UNIT', 'GALLERY'].map((kind) => [kind.toLowerCase(), (local ? {} : sizing())[`JUNO_RUNNER_${kind}_CORES`] ?? process.env[`JUNO_RUNNER_${kind}_CORES`] ?? 'default'])),
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
  `Unit test order seed ${testSeed}; \`bun run test --seed ${testSeed}\` repeats it.`,
  '',
  ...summary.suites.filter((suite) => suite.suite === 'test:gallery' && suite.walks).flatMap((suite) => [`${describeGalleryCounts(suite.walks)}${suite.reusedFrom ? ` Kept from ${suite.reusedFrom.commit.slice(0, 10)}.` : ''}`, '']),
  ...(summary.fileReuse && !baseline ? [`Test files: ${filePlan()}.`, '', ...describePlan().map((line) => `- ${line}`), ''] : []),
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
writeFileSync(join(statusDir, smoke ? 'verify-smoke.md' : 'verify-main.md'), markdown)
console.log(markdown)
if (smoke) {
  if (assessRecord(summary)) throw new Error('A smoke record must never pass the release gate')
  console.log('verify:main: smoke record checked; the release gate correctly requires a full run')
}
process.exit(summary.passed ? 0 : 1)

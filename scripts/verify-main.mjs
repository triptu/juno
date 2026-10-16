// The scheduled full run: every suite against main, on one remote machine,
// then a short summary.
//
//   pnpm verify:main                 local main
//   pnpm verify:main --ref origin/main
//   pnpm verify:main --with-mac      also, on this Mac: the e2e tests tagged @mac,
//                                    then `perf` and `test:feel`
//
// It checks main out into a temporary detached worktree, so nothing local is
// sent, and runs `test`, `specs:check` (with no cache: every Quint run),
// `test:gallery` and `test:desktop` as one plan on one machine
// (scripts/plan.mjs, through scripts/remote.mjs). The summary goes to
// .juno-status/verify-main.md and .json in this checkout, each suite's lines
// to .juno-status/verify-main/<run>/<suite>.log. The exit code is 1 if any
// suite failed. perf and test:feel time the Mac, so they run only with
// --with-mac, one after the other, each holding the whole machine; the feel
// contact sheet is copied next to the logs.

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const ref = argv.includes('--ref') ? argv[argv.indexOf('--ref') + 1] : 'main'
const withMac = argv.includes('--with-mac')

const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

const commit = git('rev-parse', ref)
const subject = git('log', '-1', '--format=%s', commit)
const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')
const statusDir = join(root, '.juno-status')
const logDir = join(statusDir, 'verify-main', runId)
mkdirSync(logDir, { recursive: true })
const checkout = join(mkdtempSync(join(tmpdir(), 'juno-verify-main-')), 'main')
git('worktree', 'add', '--detach', checkout, commit)
const removeCheckout = () => spawnSync('git', ['worktree', 'remove', '--force', checkout], { cwd: root, stdio: 'ignore' })
process.on('exit', removeCheckout)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130))

const suites = [
  { name: 'test', words: ['test'] },
  { name: 'specs:check', words: ['SPECS_CACHE=off', 'specs:check'] },
  { name: 'test:gallery', words: ['test:gallery'] },
  { name: 'test:desktop', words: ['test:desktop'] },
]

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
  const lines = text.split('\n')
  return suites.map((suite, index) => {
    const prefix = `[${suite.name}] `
    const log = join(logDir, `${suite.name.replace(/[^\w-]/g, '_')}.log`)
    writeFileSync(log, lines.filter((line) => line.startsWith(prefix) || !line.startsWith('[')).map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line).join('\n'))
    const result = lines.map((line) => new RegExp(`^plan: step ${index} \\S+ exited with (\\d+) after (\\d+) s`).exec(line)).find(Boolean)
    return { suite: suite.name, code: result ? Number(result[1]) : planned.code || 1, seconds: result ? Number(result[2]) : planned.seconds, log }
  })
}

console.log(`verify:main: ${commit.slice(0, 10)} ${subject}`)
const words = suites.flatMap((suite, index) => [...(index ? ['+'] : []), ...suite.words])
const runs = [run('plan', process.execPath, [join(checkout, 'scripts/remote.mjs'), 'test:plan', ...words], checkout, { SPECS_CACHE: 'off' }).then((planned) => splitPlan(planned))]
if (withMac) {
  // The @mac tests need the installed workspace and a build here; they take a heavy-job slot.
  runs.push(
    (async () => {
      const install = spawnSync('pnpm', ['install', '--frozen-lockfile', '--reporter=silent'], { cwd: checkout, stdio: 'ignore' })
      if (install.status !== 0) return [{ suite: 'test:desktop @mac', code: 1, seconds: 0, log: '' }]
      return [await run('test:desktop @mac', 'pnpm', ['test:desktop', '--grep', '@mac'], checkout)]
    })(),
  )
}
let results = (await Promise.all(runs)).flat()
if (withMac) {
  // After the rest, so they do not time a machine the other suites are using.
  for (const suite of ['perf', 'test:feel']) results = [...results, await run(suite, 'pnpm', [suite], checkout)]
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
  const lines = text.split('\n')
  const found = [
    ...lines.filter((line) => /^\s+\d+\) /.test(line)).map((line) => line.trim().replace(/\s*─+$/, '')),
    ...lines.filter((line) => /^did not run: |against a budget of/.test(line)).map((line) => line.trim()),
    ...lines.filter((line) => /\bFAIL\b/.test(line) && /\.test\.ts/.test(line)).map((line) => line.replace(/^.*?FAIL\s+/, 'FAIL ').trim()),
    ...lines.filter((line) => /^Error: (Quint|Spec check|Missing|A corrected|Agent schedule|No usable)/.test(line)),
    ...lines.filter((line) => /^remote: (?!.*exited with)/.test(line) && /failed|lost the connection|not reach/.test(line)),
  ]
  return [...new Set(found)].slice(0, 20)
}

const summary = {
  commit,
  subject,
  ref,
  finishedAt: new Date().toISOString(),
  passed: results.every((result) => result.code === 0),
  suites: results.map((result) => ({ ...result, log: relative(root, result.log), failures: result.code === 0 ? [] : failures(result.log) })),
}
writeFileSync(join(statusDir, 'verify-main.json'), `${JSON.stringify(summary, null, 2)}\n`)
const markdown = [
  `# verify:main ${summary.passed ? 'passed' : 'FAILED'}`,
  '',
  `${commit.slice(0, 10)} ${subject} (${ref}), finished ${summary.finishedAt}.`,
  '',
  '| Suite | Result | Time | Log |',
  '| --- | --- | --- | --- |',
  ...summary.suites.map((suite) => `| \`${suite.suite}\` | ${suite.code === 0 ? 'passed' : `failed (${suite.code})`} | ${suite.seconds} s | \`${suite.log}\` |`),
  ...summary.suites
    .filter((suite) => suite.failures.length > 0)
    .flatMap((suite) => ['', `## ${suite.suite}`, '', ...suite.failures.map((failure) => `- ${failure}`)]),
  '',
].join('\n')
writeFileSync(join(statusDir, 'verify-main.md'), markdown)
console.log(markdown)
process.exit(summary.passed ? 0 : 1)

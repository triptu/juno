// The whole release as one command (docs/development.md, "Releasing";
// .claude/skills/do-release/SKILL.md). Run it in a Juno checkout:
//
//   JUNO_UPDATE_TOKEN="$(security …)" bun run release [--notes <file>]
//   bun run release --dry-run [--notes <file>]
//   bun run release --local      the full run on this Mac, only when Tushar asks (the laptop is off)
//
// 1. Fetches main and takes its tip. Stops if the tip is already released, has
//    no user-facing change since the last release, or does not descend from it.
// 2. Prints the commits since the last release and the highlights file to write.
// 3. Bumps the patch version in a release worktree. Runs the full run on that
//    commit on the laptop while packaging and smoking it on the Mac. With --local
//    it packages and smokes first, then runs the full run on this Mac while the
//    draft uploads: every step needs the whole Mac, and the upload does not.
// 4. Requires both to pass, then waits for valid highlights and publishes.
//    A failed run discards the package and prints its failures and repair command.
// 5. Checks main's version and removes the worktree. The publisher checks GitHub.
//
// Rerun the same command after any failure: green records are reused, and an
// already published version only finishes the main version update. --dry-run
// reads GitHub and local records and changes nothing.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { compareVersions, normalizeVersion } from '../apps/desktop/src/main/releaseNotes.ts'
import { assessRecord, compatible, git, isAncestor, printGate, readRecords, releaseGate, skippedTests, statusFolder } from './release-gate.mjs'
import { highlightLines, userFacingChanges } from './release-highlights.mjs'
import { checkPublishedRelease, syncReleasedVersion } from './release-main.mjs'
import { recordReleaseTiming } from './release-timings.mjs'
import { mainCheckout, worktreeFolder } from './worktree-folder.mjs'

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    local: { type: 'boolean', default: false },
    notes: { type: 'string' },
    'notes-timeout': { type: 'string', default: '60' },
    repo: { type: 'string', default: 'triptu/juno-releases' },
  },
})
if (!Number.isFinite(Number(values['notes-timeout'])) || Number(values['notes-timeout']) <= 0) throw new Error('--notes-timeout must be a positive number')
const dry = values['dry-run']
const local = values.local
const where = local ? 'on this Mac' : 'on the laptop'
const repo = values.repo
const here = import.meta.dirname
const root = git(process.cwd(), 'rev-parse', '--show-toplevel')
const status = statusFolder(root)
const lock = join(status, 'release.lock')
const started = Date.now()
const say = (line) => console.log(`release: ${line}`)
const run = (command, args, cwd = root, env = {}) => execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
const gh = (...args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }))

let locked = false
try {
  if (!dry) {
    // Checked before the full run.
    if (!process.env.JUNO_UPDATE_TOKEN) throw new Error('JUNO_UPDATE_TOKEN is required for the packaged updater; pass it inline from the keychain (.claude/skills/do-release/SKILL.md)')
    locked = takeLock()
    // The full run and the urgent gate take laptop cores before waiting normal jobs. JUNO_PRIORITY=normal opts out.
    process.env.JUNO_PRIORITY ||= 'high'
    run('git', ['fetch', 'origin', 'main'])
  }
  await release()
} catch (error) {
  console.error(`release: ${error.message}`)
  process.exitCode = 1
} finally {
  if (locked) rmSync(lock, { recursive: true, force: true })
}

async function release() {
  const releases = gh('release', 'list', '--repo', repo, '--limit', '200', '--json', 'tagName,isDraft,isPrerelease,publishedAt')
    .filter((release) => !release.isDraft && !release.isPrerelease).toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  const latest = releases[0]
  if (latest && !dry && compareVersions(latest.tagName, JSON.parse(git(root, 'show', 'origin/main:apps/desktop/package.json')).version) > 0) {
    checkPublishedRelease(repo, latest.tagName)
    syncReleasedVersion(root, latest.tagName)
    say(`restored ${latest.tagName} on origin/main; no publish needed`)
    return
  }
  // Everything that changes the shipped app: its code and assets, and how it is built and packaged.
  const shippedPaths = ['apps/desktop/src', 'assets', ':(glob)packages/*/src/**', ':(glob)apps/desktop/*.vite.ts', 'apps/desktop/electron.vite.config.ts', 'apps/desktop/electron-builder.yml', 'apps/desktop/build', 'apps/desktop/package.json', ':(glob)packages/*/package.json', 'bun.lock']
  const tip = git(root, 'rev-parse', 'origin/main')
  const previous = latest ? previousCommit(latest.tagName) : undefined
  say(`origin/main ${tip}; last release ${latest ? `${latest.tagName} from ${previous}` : 'none'}`)
  if (tip === previous) { say('no action: origin/main is already released'); return }
  if (previous && !isAncestor(root, previous, tip)) throw new Error('origin/main does not descend from the last released source; refusing a rollback')
  const subjects = git(root, 'log', '--no-merges', '--reverse', '--format=%s', previous ? `${previous}..${tip}` : tip, '--', ...shippedPaths).split('\n')
  const changes = userFacingChanges(subjects)
  if (changes.length === 0) { say('no action: no user-facing changes since the last release'); return }
  const current = JSON.parse(git(root, 'show', `${tip}:apps/desktop/package.json`)).version
  const base = latest && compareVersions(latest.tagName, current) > 0 ? normalizeVersion(latest.tagName) : current
  const [major, minor, patch] = base.split('.').map(Number)
  const version = `${major}.${minor}.${patch + 1}`
  const notes = resolve(values.notes ?? join(status, `release-${version}-notes.md`))
  say(`releasing ${version} from ${tip}`)
  say(`${changes.length} change(s) since the last release, the input for the highlights:`)
  for (const change of changes) console.log(`  ${change}`)
  say(`write the highlights to ${notes} (3 to 8 "- " lines; do-release skill, "Write the highlights")`)

  if (dry) {
    const ready = await fullRun(tip)
    if (existsSync(notes)) {
      try { printHighlights(highlightLines(readFileSync(notes, 'utf8'))) } catch (error) { say(`${notes}: ${error.message}`) }
    } else say(`no highlights at ${notes} yet`)
    say(local
      ? `prepare the version commit first; package and smoke it, then ${ready ? 'reuse its covering full run' : 'verify that commit on this Mac'} while uploading a draft; then wait for highlights, publish to ${repo}, check the release and main`
      : `prepare the version commit first; ${ready ? 'reuse its covering full run' : 'verify that commit on the laptop'} while packaging, smoking and uploading a draft on the Mac; then wait for highlights, publish to ${repo}, check the release and main`)
    return
  }
  const checkout = prepare(tip, version)
  const build = git(checkout, 'rev-parse', 'HEAD')
  const detail = { version, source: tip, build }
  const publisher = async (args) => {
    const code = await runAsync(process.execPath, [join(here, 'release-publish.ts'), '--checkout', checkout, '--source', tip, '--repo', repo, ...args], checkout)
    if (code !== 0) throw new Error(`release:publish ${args.join(' ')} failed (${code})`)
  }
  // Its preflight may refuse an unchanged failed commit, before anything is built.
  const verify = fullRun(build)
  const verifying = () => Promise.resolve(verify === true || verify())
  let outcomes
  if (local) {
    // On the Mac the package, its smoke test and the full run each take the whole machine (the exclusive heavy lock),
    // so they run one after another. Packaging first lets the draft upload, which needs only the network, run beside
    // the full run instead of after it.
    const packaged = await Promise.allSettled([packageRelease(checkout, detail)])
    outcomes = packaged[0].status === 'rejected' ? packaged
      : await Promise.allSettled([verifying(), timed('stage draft', detail, () => publisher(['--stage']))])
  } else {
    let verificationFailed = false
    const verification = verifying().catch((error) => { verificationFailed = true; throw error })
    outcomes = await Promise.allSettled([verification, packageRelease(checkout, detail).then(async () => {
      if (!verificationFailed) await timed('stage draft', detail, () => publisher(['--stage']))
    })])
  }
  const failed = outcomes.find((outcome) => outcome.status === 'rejected')
  if (failed) {
    try { await publisher(['--discard-draft']) } catch (error) { say(`draft cleanup failed: ${error.message}; inspect the draft before rerunning`) }
    rmSync(join(checkout, 'apps/desktop/release'), { recursive: true, force: true })
    throw failed.reason
  }
  await timed('highlights wait', detail, () => waitForHighlights(notes))
  await timed('publish', detail, () => publisher(['--notes', notes]))
  check(version)
  timedSync('cleanup', { version, source: tip }, () => run(process.execPath, [join(here, 'worktree.mjs'), 'remove', `release-${version}`, '--force']))
  say(`released ${version} from ${tip} in ${Math.round((Date.now() - started) / 1000)} s`)
}

/**
 * Whether a green full run covers the tip: true, false on a dry run that would need one, or else a function that runs
 * one on the laptop (with --local, on this Mac). Only a run on the same kind of machine is repaired, since a repair
 * keeps its baseline's runtime.
 */
function fullRun(tip) {
  const covered = releaseGate(root, tip, readRecords(status))
  if (covered) { printGate(covered); return true }
  const records = readRecords(status)
  const newest = records.find((record) => record.smoke !== true && !record.reachOnly && (record.execution?.mode ?? 'remote') === (local ? 'local' : 'remote') && isAncestor(root, record.commit, tip))
  const repairable = newest && !assessRecord(newest) && !skippedTests(newest) && newest.version === 2 && newest.identity && newest.required && !newest.required.some((suite) => ['test:desktop @mac', 'perf @mac', 'test:feel'].includes(suite))
  if (repairable && newest.commit === tip) {
    report(newest, recordFile(newest))
    throw new Error('the newest full run at the tip failed and main has not changed since; fix the failures first')
  }
  const args = [...(repairable ? ['--ref', tip, '--repair', recordFile(newest)] : ['--ref', tip]), local ? '--local' : '--require-remote']
  const command = `bun run verify:main ${args.join(' ')}`
  if (dry) { say(`no green full run covers ${tip}; would run ${command} ${where}`); return false }
  return () => {
    say(`no green full run covers ${tip}; running ${command} ${where}. Write the highlights meanwhile.`)
    const begun = new Date().toISOString()
    const begunAt = Date.now()
    return runAsync('bun', ['run', 'verify:main', ...args]).then((exit) => {
      recordReleaseTiming('full run', begunAt, { source: tip, status: exit === 0 ? 'passed' : 'failed', ...(local ? { local } : {}) }, root)
      const gate = exit === 0 ? releaseGate(root, tip) : null
      if (gate) { printGate(gate); return true }
      const record = readRecords(status).find((record) => record.commit === tip && record.finishedAt >= begun)
      if (record) report(record, recordFile(record))
      else say(`the full run exited with ${exit} and wrote no record; see its output above`)
      throw new Error('the full run failed; discarding the package; nothing was published')
    })
  }
}

/** The failed suites of a full-run record, their causes and the way on. */
function report(record, file) {
  say(`the full run at ${record.commit} failed: ${file}`)
  for (const suite of record.suites.filter((suite) => suite.code !== 0 || suite.tests?.status === 'failed')) {
    const cause = suite.cause ? `, cause ${suite.cause.category}${suite.cause.provisional ? ' (provisional)' : ''}${suite.cause.evidence ? `: ${suite.cause.evidence}` : ''}` : ''
    console.log(`  ${suite.suite}: failed (${suite.code})${cause}`)
    for (const failure of suite.failures ?? []) console.log(`    - ${failure}`)
    if (suite.log) console.log(`    log ${suite.log}`)
  }
  say('confirm each cause: bun scripts/verify-records.mjs <record> <suite> product|test|infrastructure|cancellation "evidence"')
  say('fix the failures and push the fixes to main, then rerun this command. A repair requires the failed commit to be an ancestor; otherwise it starts a fresh full run.')
  console.log(`  bun run verify:main --ref <fixed-descendant-of-${record.commit}> --repair ${file}`)
}

/** The file a record was read from, for --repair. */
function recordFile(record) {
  const folder = join(status, 'verify-main', 'commits', record.commit)
  const files = existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith('.json')).map((name) => join(folder, name)) : []
  return [...files, join(status, 'verify-main.json')].find((file) => {
    try { return JSON.parse(readFileSync(file, 'utf8')).finishedAt === record.finishedAt } catch { return false }
  })
}

/** Waits until the highlights file exists, has settled for a second and is valid. */
async function waitForHighlights(file) {
  const deadline = Date.now() + Number(values['notes-timeout']) * 60_000
  let checked
  say(`waiting for the highlights at ${file}`)
  for (;;) {
    const stamp = existsSync(file) ? statSync(file).mtimeMs : undefined
    if (stamp !== undefined && stamp !== checked && Date.now() - stamp > 1000) {
      checked = stamp
      const text = readFileSync(file, 'utf8')
      try {
        printHighlights(highlightLines(text))
        return
      } catch (error) {
        say(`${file}: ${error.message}; waiting for a corrected file`)
      }
    }
    if (Date.now() > deadline) throw new Error(`no valid highlights at ${file} after ${values['notes-timeout']} min; write them and rerun this command (the full run is not repeated)`)
    await sleep(250)
  }
}

function printHighlights(lines) {
  say(`${lines.length} highlight(s):\n${lines.map((line) => `- ${line}`).join('\n')}`)
}

function previousCommit(tag) {
  const release = gh('release', 'view', tag, '--repo', repo, '--json', 'body')
  const source = /<!-- juno-source: ([a-f0-9]{40}) -->/.exec(release.body)?.[1]
  if (source) return source
  const legacy = git(root, 'log', 'origin/main', '--format=%H', '--fixed-strings', `--grep=Release ${normalizeVersion(tag)}`).split('\n')
    .find((commit) => commit && git(root, 'show', '-s', '--format=%s', commit) === `Release ${normalizeVersion(tag)}`)
  if (!legacy) throw new Error(`cannot identify the source of ${tag}`)
  return legacy
}

function prepare(source, version) {
  const name = `release-${version}`
  const checkout = join(worktreeFolder(mainCheckout(root)), name)
  timedSync('prepare', { version, source }, () => {
    if (existsSync(checkout)) {
      const build = git(checkout, 'rev-parse', 'HEAD')
      const parent = git(checkout, 'rev-parse', 'HEAD^')
      const manifest = JSON.parse(readFileSync(join(checkout, 'apps/desktop/package.json'), 'utf8'))
      if (git(checkout, 'status', '--porcelain') || git(checkout, 'branch', '--show-current')
        || manifest.version !== version || git(checkout, 'diff', '--name-only', parent, build) !== 'apps/desktop/package.json'
        || !compatible(root, parent, build)) throw new Error(`${checkout} is not a clean release worktree; inspect it and remove it with bun scripts/worktree.mjs remove release-${version} --force`)
      if (parent === source) return
      run(process.execPath, [join(here, 'release-publish.ts'), '--checkout', checkout, '--repo', repo, '--discard-draft'], checkout)
      run(process.execPath, [join(here, 'worktree.mjs'), 'remove', name, '--force'])
    }
    run(process.execPath, [join(here, 'worktree.mjs'), 'add', name, '--detach', source])
    const file = join(checkout, 'apps/desktop/package.json')
    const text = readFileSync(file, 'utf8')
    writeFileSync(file, text.replace(/("version"\s*:\s*")[^"]+"/, `$1${version}"`))
    run('git', ['commit', '-qm', `Release ${version}`, '--', 'apps/desktop/package.json'], checkout)
  })
  return checkout
}

async function packageRelease(checkout, detail) {
  for (const [step, script] of [['package', 'package'], ['package-smoke', 'test:package']]) {
    await timed(step, detail, async () => {
      const code = await runAsync('bun', ['run', script], checkout, { JUNO_E2E_AI_JOBS: '1' })
      if (code !== 0) throw new Error(`${script} failed (${code}); nothing was published`)
    })
  }
}

function runAsync(command, args, cwd = root, env = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
    child.on('error', reject)
    child.on('close', (code) => done(code ?? 1))
  })
}

/** The publisher already checked GitHub; check the version that reached main. */
function check(version) {
  git(root, 'fetch', 'origin', 'main')
  const main = JSON.parse(git(root, 'show', 'origin/main:apps/desktop/package.json')).version
  if (compareVersions(main, version) < 0) throw new Error(`origin/main is still at version ${main}`)
  say(`origin/main is at version ${main}`)
}

async function timed(step, detail, work) {
  const begun = Date.now()
  let outcome = 'failed'
  try {
    const result = await work()
    outcome = 'passed'
    return result
  } finally {
    recordReleaseTiming(step, begun, { ...detail, status: outcome }, root)
  }
}

function timedSync(step, detail, work) {
  const begun = Date.now()
  let outcome = 'failed'
  try {
    work()
    outcome = 'passed'
  } finally {
    recordReleaseTiming(step, begun, { ...detail, status: outcome }, root)
  }
}

/** One release at a time. A lock whose process has gone is taken over. */
function takeLock() {
  mkdirSync(status, { recursive: true })
  try {
    mkdirSync(lock)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    let pid
    try { pid = Number(readFileSync(join(lock, 'pid'), 'utf8')) } catch { /* Not written yet, or never. */ }
    const alive = () => { try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' } }
    if (pid ? alive() : Date.now() - statSync(lock).mtimeMs < 60_000) throw new Error(`another release is running (pid ${pid ?? 'unknown'}); its lock is ${lock}`, { cause: error })
    say(`taking over the lock of pid ${pid ?? 'unknown'}, which has gone`)
    rmSync(lock, { recursive: true, force: true })
    mkdirSync(lock)
  }
  writeFileSync(join(lock, 'pid'), String(process.pid))
  return true
}

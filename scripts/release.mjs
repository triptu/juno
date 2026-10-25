// The whole release as one command (docs/development.md, "Releasing";
// .claude/skills/do-release/SKILL.md). Run it in a Juno checkout:
//
//   JUNO_UPDATE_TOKEN="$(security …)" bun run release [--notes <file>] [--nightly]
//   bun run release --dry-run [--notes <file>]
//
// 1. Fetches main and takes its tip. Stops if the tip is already released, has
//    no user-facing change since the last release, or does not descend from it.
// 2. Prints the commits since the last release and the highlights file to write.
// 3. Unless a green full run covers the tip, runs one on the laptop
//    (verify:main --ref <tip> --release), or a repair of the newest failed run when
//    main has changed since it. A red run stops with its failures and the repair
//    command. --release adds the nightly tests the change reaches since each last
//    passed; when the full run alone covers the tip, it runs only those
//    (verify:main --nightly-reach-only).
// 4. Waits for the highlights file, which the agent writes while the full run goes.
// 5. Bumps the patch version in a release worktree, packages, runs the packaged
//    smoke, publishes, checks the GitHub release and main's version, and removes
//    the worktree. With --nightly, it pushes the refreshed coverage map first.
//
// Rerun the same command after any failure: green records are reused, and an
// already published version only finishes the main version update. --dry-run
// reads GitHub and local records and changes nothing.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { compareVersions, normalizeVersion } from '../apps/desktop/src/main/releaseNotes.ts'
import { MAP_PATH } from './coverage-map.mjs'
import { assessRecord, fullRunGate, git, isAncestor, nightlyCovered, nightlyGate, printGate, readRecords, releaseGate, statusFolder } from './release-gate.mjs'
import { highlightLines, userFacingChanges } from './release-highlights.mjs'
import { checkPublishedRelease, commitOnMain, syncReleasedVersion } from './release-main.mjs'
import { recordReleaseTiming } from './release-timings.mjs'
import { mainCheckout, worktreeFolder } from './worktree-folder.mjs'

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    nightly: { type: 'boolean', default: false },
    notes: { type: 'string' },
    'notes-timeout': { type: 'string', default: '60' },
    repo: { type: 'string', default: 'triptu/juno-releases' },
  },
})
if (!Number.isFinite(Number(values['notes-timeout'])) || Number(values['notes-timeout']) <= 0) throw new Error('--notes-timeout must be a positive number')
const dry = values['dry-run']
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
    // Checked before the full run, not twenty minutes into it.
    if (process.env.JUNO_RELEASE === '1') throw new Error('Juno releases are unsigned; unset JUNO_RELEASE')
    if (!process.env.JUNO_UPDATE_TOKEN) throw new Error('JUNO_UPDATE_TOKEN is required for the packaged updater; pass it inline from the keychain (.claude/skills/do-release/SKILL.md)')
    locked = takeLock()
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
  const tip = git(root, 'rev-parse', 'origin/main')
  const previous = latest ? previousCommit(latest.tagName) : undefined
  say(`origin/main ${tip}; last release ${latest ? `${latest.tagName} from ${previous}` : 'none'}`)
  if (tip === previous) { say('no action: origin/main is already released'); return }
  if (previous && !isAncestor(root, previous, tip)) throw new Error('origin/main does not descend from the last released source; refusing a rollback')
  const subjects = git(root, 'log', '--no-merges', '--reverse', '--format=%s', previous ? `${previous}..${tip}` : tip, '--', 'apps/desktop/src', 'assets', ':(glob)packages/*/src/**').split('\n')
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

  const ready = await fullRun(tip)
  if (dry) {
    if (existsSync(notes)) {
      try { printHighlights(highlightLines(readFileSync(notes, 'utf8'))) } catch (error) { say(`${notes}: ${error.message}`) }
    } else say(`no highlights at ${notes} yet`)
    say(`${ready ? 'then' : 'after it'}: wait for the highlights, package, packaged smoke, publish to ${repo}, check the release and main`)
    return
  }
  await timed('highlights wait', { version, source: tip }, () => waitForHighlights(notes))
  publish(tip, version, notes)
  check(version)
  timedSync('cleanup', { version, source: tip }, () => run(process.execPath, [join(here, 'worktree.mjs'), 'remove', `release-${version}`, '--force']))
  say(`released ${version} from ${tip} in ${Math.round((Date.now() - started) / 1000)} s`)
}

/** Makes sure a green full run and the nightly tier cover the tip, running them on the laptop if needed. False on a dry run that would need one. */
async function fullRun(tip) {
  const covered = releaseGate(root, tip, readRecords(status))
  if (covered) { printGate(covered); if (!dry) pushCoverage(tip); return true }
  if (!fullRunGate(root, tip, readRecords(status)) && !(await fullSuites(tip))) return false
  if (!nightlyGate(root, tip, readRecords(status)) && !nightlyReach(tip)) return false
  const gate = releaseGate(root, tip)
  if (!gate) throw new Error('the full run and the nightly tier passed, but no record covers the tip; see the records above')
  printGate(gate)
  pushCoverage(tip)
  return true
}

/** Runs the full run, or the repair of the newest failed one, with the nightly tests it reaches. */
async function fullSuites(tip) {
  const records = readRecords(status)
  const newest = records.find((record) => record.smoke !== true && !record.reachOnly && isAncestor(root, record.commit, tip))
  const repairable = newest && !assessRecord(newest) && newest.version === 2 && newest.identity && newest.required && !newest.required.some((suite) => ['test:desktop @mac', 'perf @mac', 'test:feel'].includes(suite))
  if (repairable && newest.commit === tip) {
    report(newest, recordFile(newest))
    throw new Error('the newest full run at the tip failed and main has not changed since; fix the failures first')
  }
  // A nightly run runs every nightly test; a repair leaves the nightly reach to its own run afterwards.
  const args = repairable ? ['--ref', tip, '--repair', recordFile(newest)] : ['--ref', tip, ...(values.nightly ? ['--nightly'] : ['--release'])]
  if (repairable && values.nightly) say('--nightly does not apply to a repair; the coverage map is not refreshed')
  args.push('--require-remote')
  const command = `bun run verify:main ${args.join(' ')}`
  if (dry) { say(`no green full run covers ${tip}; would run ${command} on the laptop`); return false }
  say(`no green full run covers ${tip}; running ${command} on the laptop. Write the highlights meanwhile.`)
  if (values.nightly && git(root, 'status', '--porcelain', '--', MAP_PATH)) throw new Error(`commit or save changes to ${MAP_PATH} before a nightly release`)
  const begun = new Date().toISOString()
  const begunAt = Date.now()
  const exit = spawnSync('bun', ['run', 'verify:main', ...args], { cwd: root, stdio: 'inherit' }).status
  recordReleaseTiming('full run', begunAt, { source: tip, status: exit === 0 ? 'passed' : 'failed' }, root)
  if (values.nightly && !repairable && git(root, 'status', '--porcelain', '--', MAP_PATH)) {
    writeFileSync(join(status, 'release-coverage.json'), JSON.stringify({ source: tip, map: readFileSync(join(root, MAP_PATH), 'utf8') }))
    git(root, 'checkout', '--', MAP_PATH)
  }
  if (exit === 0 && fullRunGate(root, tip)) return true
  const record = readRecords(status).find((record) => record.commit === tip && record.finishedAt >= begun)
  if (record) report(record, recordFile(record))
  else say(`the full run exited with ${exit} and wrote no record; see its output above`)
  throw new Error('the full run failed; nothing was built or published')
}

/** Runs the nightly tests the change since each last passed reaches (scripts/nightly-reach.mjs). */
function nightlyReach(tip) {
  const command = `bun run verify:main --ref ${tip} --nightly-reach-only --require-remote`
  const newest = readRecords(status).find((record) => record.reachOnly && record.commit === tip)
  if (newest && !nightlyCovered(newest)) {
    report(newest, recordFile(newest))
    throw new Error('the newest nightly reach at the tip failed and main has not changed since; fix the failures first')
  }
  if (dry) { say(`the full run covers ${tip}, but the nightly tier does not; would run ${command} on the laptop`); return false }
  say(`the full run covers ${tip}, but the nightly tier does not; running ${command} on the laptop`)
  const begun = new Date().toISOString()
  const begunAt = Date.now()
  const exit = spawnSync('bun', ['run', 'verify:main', '--ref', tip, '--nightly-reach-only', '--require-remote'], { cwd: root, stdio: 'inherit' }).status
  recordReleaseTiming('nightly reach', begunAt, { source: tip, status: exit === 0 ? 'passed' : 'failed' }, root)
  if (exit === 0 && nightlyGate(root, tip)) return true
  const record = readRecords(status).find((record) => record.commit === tip && record.finishedAt >= begun)
  if (record) report(record, recordFile(record))
  else say(`the nightly reach exited with ${exit} and wrote no record; see its output above`)
  throw new Error('the nightly tests failed; nothing was built or published')
}

/** Preserve a nightly map across a failed run and publish it after the gate passes. */
function pushCoverage(tip) {
  const pending = join(status, 'release-coverage.json')
  if (!existsSync(pending)) return
  const { source, map } = JSON.parse(readFileSync(pending, 'utf8'))
  if (!isAncestor(root, source, tip)) throw new Error('pending nightly coverage is not from an ancestor of this release')
  commitOnMain(root, 'Refresh the e2e coverage map', (checkout) => {
    writeFileSync(join(checkout, MAP_PATH), map)
    return [MAP_PATH]
  }, () => git(root, 'show', `origin/main:${MAP_PATH}`) === map.trim())
  rmSync(pending)
  say(`pushed the refreshed ${MAP_PATH} to main`)
}

/** The failed suites of a full-run or nightly reach record, their causes and the way on. */
function report(record, file) {
  say(`the ${record.reachOnly ? 'nightly reach' : 'full run'} at ${record.commit} failed: ${file}`)
  for (const suite of record.suites.filter((suite) => suite.code !== 0 || suite.tests?.status === 'failed')) {
    const cause = suite.cause ? `, cause ${suite.cause.category}${suite.cause.provisional ? ' (provisional)' : ''}${suite.cause.evidence ? `: ${suite.cause.evidence}` : ''}` : ''
    console.log(`  ${suite.suite}: failed (${suite.code})${cause}`)
    for (const failure of suite.failures ?? []) console.log(`    - ${failure}`)
    if (suite.log) console.log(`    log ${suite.log}`)
  }
  say('confirm each cause: bun scripts/verify-records.mjs <record> <suite> product|test|infrastructure|cancellation "evidence"')
  if (record.reachOnly) { say('fix the failures and push the fixes to main, then rerun this command: it runs the nightly tests the fix reaches again'); return }
  say('fix the failures and push the fixes to main, then rerun this command: it runs the repair itself. The repair by hand:')
  console.log(`  bun run verify:main --ref origin/main --repair ${file}`)
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

function publish(source, version, notes) {
  const name = `release-${version}`
  const checkout = join(worktreeFolder(mainCheckout(root)), name)
  const detail = { version, source }
  // A failed release keeps its worktree for inspection; a rerun refuses to reuse it.
  timedSync('prepare', detail, () => {
    run(process.execPath, [join(here, 'worktree.mjs'), 'add', name, '--detach', source])
    const file = join(checkout, 'apps/desktop/package.json')
    const text = readFileSync(file, 'utf8')
    writeFileSync(file, text.replace(/("version"\s*:\s*")[^"]+"/, `$1${version}"`))
    run('git', ['commit', '-qm', `Release ${version}`, '--', 'apps/desktop/package.json'], checkout)
  })
  timedSync('package', detail, () => run('bun', ['run', 'package'], checkout))
  timedSync('package-smoke', detail, () => run('bun', ['run', 'test:package'], checkout, { JUNO_E2E_AI_JOBS: '1' }))
  timedSync('publish', detail, () => run(process.execPath, [join(here, 'release-publish.ts'), '--checkout', checkout, '--source', source, '--repo', repo, '--notes', notes], checkout))
}

/** Checks what installs will see: the release, its files, the latest mark, and main's version. */
function check(version) {
  checkPublishedRelease(repo, version)
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

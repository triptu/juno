// Picks and publishes a release on the release Mac, at most one every six
// hours. Nothing runs it on a schedule. --dry-run reads GitHub and local
// verification records without fetching, building, committing or publishing.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { compareVersions, normalizeVersion } from '../apps/desktop/src/main/releaseNotes.ts'
import { git, isAncestor, printGate, readRecords, releaseGate, statusFolder } from './release-gate.mjs'
import { releaseDue, releaseNotes, selectCommit } from './release-schedule.mjs'
import { syncReleasedVersion } from './release-main.mjs'
import { mainCheckout, worktreeFolder } from './worktree-folder.mjs'

const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false }, repo: { type: 'string', default: 'triptu/juno-releases' } } })
const status = statusFolder(root)
const lock = join(status, 'release-scheduled.lock')
const run = (command, args, cwd = root, env = {}) => execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
const gh = (...args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }))
let locked = false
try {
  if (!values['dry-run']) {
    mkdirSync(status, { recursive: true })
    mkdirSync(lock)
    locked = true
    writeFileSync(join(lock, 'pid'), String(process.pid))
    run('git', ['fetch', 'origin', 'main'])
  }
  await scheduled()
} catch (error) {
  console.error(`release:scheduled: ${error.message}`)
  process.exitCode = 1
} finally {
  if (locked) rmSync(lock, { recursive: true, force: true })
}

async function scheduled() {
  const releases = gh('release', 'list', '--repo', values.repo, '--limit', '200', '--json', 'tagName,isDraft,isPrerelease,publishedAt')
    .filter((release) => !release.isDraft && !release.isPrerelease).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  const latest = releases[0]
  if (latest && !values['dry-run'] && syncReleasedVersion(root, latest.tagName)) {
    console.log(`release:scheduled: restored ${latest.tagName} on origin/main; no publish needed`)
    return
  }
  const tip = git(root, 'rev-parse', 'origin/main')
  const records = readRecords(status)
  const candidate = selectCommit(root, tip, records)
  const previous = latest ? previousCommit(latest.tagName) : undefined
  const reason = releaseDue({ candidate, previous, publishedAt: latest?.publishedAt })
  console.log(`release:scheduled: origin/main ${tip}; ${records.length} full-run record(s)`)
  if (candidate) printGate(releaseGate(root, candidate, records))
  if (reason) { console.log(`release:scheduled: no action: ${reason}`); return }
  if (previous && !isAncestor(root, previous, candidate)) throw new Error('selected commit does not descend from the last released source; refusing a rollback')
  const current = JSON.parse(git(root, 'show', `${candidate}:apps/desktop/package.json`)).version
  const base = latest && compareVersions(latest.tagName, current) > 0 ? normalizeVersion(latest.tagName) : current
  const parts = base.split('.').map(Number)
  const version = `${parts[0]}.${parts[1]}.${parts[2] + 1}`
  const subjects = git(root, 'log', '--no-merges', '--reverse', '--format=%s', previous ? `${previous}..${candidate}` : candidate, '--', 'apps/desktop/src', 'assets', ':(glob)packages/*/src/**').split('\n')
  const notes = releaseNotes(subjects)
  if (!notes.trim()) { console.log('release:scheduled: no action: no user-facing changes since the last release'); return }
  console.log(`release:scheduled: would release ${version} from ${candidate}\n${notes}`)
  if (values['dry-run']) return
  if (!process.env.JUNO_UPDATE_TOKEN) throw new Error('JUNO_UPDATE_TOKEN is required for the packaged updater')
  publish(candidate, version, notes)
}

function previousCommit(tag) {
  const release = gh('release', 'view', tag, '--repo', values.repo, '--json', 'body')
  const source = /<!-- juno-source: ([a-f0-9]{40}) -->/.exec(release.body)?.[1]
  if (source) return source
  const legacy = git(root, 'log', 'origin/main', '--format=%H', '--fixed-strings', `--grep=Release ${normalizeVersion(tag)}`).split('\n')
    .find((commit) => commit && git(root, 'show', '-s', '--format=%s', commit) === `Release ${normalizeVersion(tag)}`)
  if (!legacy) throw new Error(`cannot identify the source of ${tag}`)
  return legacy
}

function publish(candidate, version, notes) {
  const name = `scheduled-release-${version}`
  const checkout = join(worktreeFolder(mainCheckout(root)), name)
  const notesFile = join(status, `${name}-notes.md`)
  writeFileSync(notesFile, notes)
  // Keep a failed checkout for inspection. Never silently resume a partial publish.
  run('node', ['scripts/worktree.mjs', 'add', name, '--base', candidate])
  run('pnpm', ['release:version', version], checkout)
  run('git', ['add', 'apps/desktop/package.json'], checkout)
  run('git', ['commit', '-m', `Release ${version}`], checkout)
  const heavy = join(root, 'scripts/heavy.mjs')
  const priority = readFileSync(heavy, 'utf8').includes('--priority') ? ['--priority', 'release'] : []
  run('node', [heavy, ...priority, '--electron', 'pnpm', 'package'], checkout)
  run('node', [heavy, ...priority, '--electron', 'pnpm', 'test:package'], checkout, { JUNO_E2E_AI_JOBS: '1' })
  run('node', [join(root, 'scripts/release-publish.ts'), '--checkout', checkout, '--source', candidate, '--repo', values.repo, '--notes', notesFile], checkout)
  run('node', ['scripts/worktree.mjs', 'remove', name])
}

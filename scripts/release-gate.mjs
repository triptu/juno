import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sameIdentity } from './verify-inputs.mjs'
import { suitePassed } from './verify-repair.mjs'

export const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
export const statusFolder = (root) => resolve(root, git(root, 'rev-parse', '--git-common-dir'), '../.juno-status')
export const isAncestor = (root, ancestor, commit) => spawnSync('git', ['merge-base', '--is-ancestor', ancestor, commit], { cwd: root, stdio: 'ignore' }).status === 0

export function readRecords(status) {
  const folder = join(status, 'verify-main', 'commits')
  const files = existsSync(folder) ? readdirSync(folder, { recursive: true }).filter((file) => file.endsWith('.json')).map((file) => join(folder, file)) : []
  if (existsSync(join(status, 'verify-main.json'))) files.push(join(status, 'verify-main.json'))
  const records = files.map((file) => JSON.parse(readFileSync(file, 'utf8')))
    .filter((record) => /^[a-f0-9]{40}$/.test(record.commit) && Array.isArray(record.suites))
    .toSorted((a, b) => b.finishedAt.localeCompare(a.finishedAt))
  return [...new Map(records.map((record) => [`${record.commit}:${record.finishedAt}`, record])).values()]
}

/**
 * Whether a record's suites skipped tests: before 10-26 a normal full run skipped the tests now tagged @heavy
 * outside the sync and gallery areas (`JUNO_SKIP_TAGS=@nightly`). Such a record is not a full run, and no repair
 * starts from it.
 */
export const skippedTests = (record) => record.suites.some((suite) => (suite.command ?? []).some((word) => /^JUNO_SKIP_TAGS=.*@nightly/.test(word)))

/** A gallery that reused walk records must have counted what it walked, reused and sampled, under its own seed. */
const galleryCounted = (suite) => {
  const seed = (suite.command ?? []).find((word) => word.startsWith('GALLERY_SAMPLE='))?.slice('GALLERY_SAMPLE='.length)
  return seed === undefined || suite.walks?.sample?.seed === seed
}

/** A full run passes only when every required suite ran, skipped no tests, passed and, in the gallery, counted its sample. */
export function assessRecord(record) {
  const required = record.version === 2 ? ['test', 'specs:check', 'specs:conformance', 'test:gallery',
    ...(record.required?.includes('test:browser') ? ['test:browser', 'test:electron'] : ['test:desktop'])] : ['test', 'specs:check', 'test:gallery', 'test:desktop']
  return record.smoke !== true && record.passed === true
    && !skippedTests(record)
    && required.every((name) => record.suites.some((suite) => suite.suite === name))
    && record.suites.every(suitePassed)
    && record.suites.every(galleryCounted)
    && record.suites.filter((suite) => !['test:desktop @mac', 'perf', 'perf @mac', 'test:feel'].includes(suite.suite)).every((suite) => !suite.identity || sameIdentity(suite.identity, record.identity))
    && (record.version !== 2 || (record.identity && record.required?.every((name) => record.suites.some((suite) => suite.suite === name))))
}

export function docsOrTests(file) {
  return /^(docs\/|\.claude\/skills\/)/.test(file) || /(^|\/)(README|CLAUDE|AGENTS|CHANGELOG)\.md$/.test(file)
    || /^(packages\/[^/]+\/test\/|apps\/desktop\/e2e\/|apps\/desktop\/dom\/)/.test(file)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
}

export function compatible(root, green, commit) {
  if (!isAncestor(root, green, commit)) return false
  const files = git(root, 'diff', '--name-only', green, commit, '--').split('\n').filter(Boolean)
  if (files.some((file) => file !== 'apps/desktop/package.json' && !docsOrTests(file))) return false
  if (!files.includes('apps/desktop/package.json')) return true
  const before = JSON.parse(git(root, 'show', `${green}:apps/desktop/package.json`))
  const after = JSON.parse(git(root, 'show', `${commit}:apps/desktop/package.json`))
  return JSON.stringify({ ...before, version: after.version }) === JSON.stringify(after)
}

/** A green full run that covers `commit`, or null. */
export function releaseGate(root, commit, records = readRecords(statusFolder(root))) {
  const provenance = (record, seen = new Set()) => {
    if (!record.repair) return true
    const key = `${record.commit}:${record.finishedAt}`
    if (seen.has(key) || record.repair.selection !== 'graph-uncapped') return false
    seen.add(key)
    const previous = records.find((candidate) => candidate.commit === record.repair.commit && candidate.finishedAt === record.repair.finishedAt)
    return previous?.version === 2 && sameIdentity(previous.identity, record.identity)
      && isAncestor(root, previous.commit, record.commit)
      && previous.required?.every((name) => record.suites.some((suite) => suite.suite === name))
      && provenance(previous, seen)
  }
  for (const record of records) {
    if (assessRecord(record) && provenance(record) && compatible(root, record.commit, commit)) return { commit, record }
  }
  return null
}

export function printGate(gate) {
  console.log(`release gate: ${gate.commit} covered by full run ${gate.record.commit} (${gate.record.finishedAt})`)
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..')
  const commit = git(root, 'rev-parse', process.argv[2] ?? 'HEAD')
  const gate = releaseGate(root, commit)
  if (gate) printGate(gate)
  else {
    console.error(`release gate: no eligible full-run record for ${commit}`)
    process.exitCode = 1
  }
}

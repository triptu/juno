import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

export function readWaivers(status) {
  const file = join(status, 'release-waivers.json')
  const entries = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
  if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry.id !== 'string' || !entry.id.trim() || typeof entry.reason !== 'string' || !entry.reason.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date)))) {
    throw new Error('release-waivers.json must contain entries with a test id, reason and YYYY-MM-DD date')
  }
  return entries
}

/** Only complete test reports can waive a failing suite. Infrastructure errors stay red. */
export function assessRecord(record, waivers) {
  const required = ['test', 'specs:check', 'test:gallery', 'test:desktop']
  if (!required.every((name) => record.suites.some((suite) => suite.suite === name))) return null
  const waived = []
  for (const suite of record.suites) {
    if (suite.code === 0) continue
    const report = suite.tests
    if (suite.code !== 1 || !report || report.status !== 'failed' || report.errors !== 0 || report.incomplete !== 0 || !report.failures?.length) return null
    for (const failure of report.failures) {
      const waiver = waivers.find((entry) => entry.id === failure.id)
      if (!waiver) return null
      waived.push({ ...waiver, title: failure.title, suite: suite.suite })
    }
  }
  return waived.length || record.passed === true ? waived : null
}

export function docsOrTests(file) {
  return /^(docs\/|\.claude\/skills\/)/.test(file) || /(^|\/)(README|CLAUDE|AGENTS|CHANGELOG)\.md$/.test(file)
    || /^(packages\/[^/]+\/test\/|apps\/desktop\/e2e\/)/.test(file)
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

export function releaseGate(root, commit, records = readRecords(statusFolder(root)), waivers = readWaivers(statusFolder(root))) {
  for (const record of records) {
    const waived = assessRecord(record, waivers)
    if (waived && compatible(root, record.commit, commit)) return { commit, record, waived }
  }
  return null
}

export function printGate(gate) {
  console.log(`release gate: ${gate.commit} covered by full run ${gate.record.commit} (${gate.record.finishedAt})`)
  for (const entry of gate.waived) console.log(`  WAIVED ${entry.id}: ${entry.title} — ${entry.reason} (${entry.date})`)
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..')
  const commit = git(root, 'rev-parse', process.argv[2] ?? 'HEAD')
  const gate = releaseGate(root, commit)
  if (gate) printGate(gate)
  else { console.error(`release gate: no eligible full-run record for ${commit}`); process.exitCode = 1 }
}

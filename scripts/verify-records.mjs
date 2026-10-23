import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sameIdentity } from './verify-inputs.mjs'
import { failureCause } from './test-results-reporter.mjs'
import { statusFolder } from './release-gate.mjs'

/** Confirm triage on a full-run or affected record without changing its outcome. */
export function classifyRecord(file, suite, category, evidence, status) {
  if (!evidence?.trim()) throw new Error('Classification needs evidence')
  const record = JSON.parse(readFileSync(file, 'utf8'))
  const failed = record.suites.find((item) => item.suite === suite)
  if (!failed || failed.code === 0) throw new Error(`No failed ${suite} suite in this record`)
  failed.cause = failureCause({ code: failed.code, cause: category, note: evidence })
  const targets = new Set([file])
  if (record.commit && status) {
    const folder = join(status, 'verify-main', 'commits', record.commit)
    if (existsSync(folder)) for (const name of readdirSync(folder).filter((name) => name.endsWith('.json'))) targets.add(join(folder, name))
    if (existsSync(join(status, 'verify-main.json'))) targets.add(join(status, 'verify-main.json'))
  }
  for (const target of targets) {
    const saved = JSON.parse(readFileSync(target, 'utf8'))
    if (saved.finishedAt !== record.finishedAt || saved.commit !== record.commit) continue
    const temporary = `${target}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n')
    renameSync(temporary, target)
  }
}

/** Newest matching successful per-file measurements, in test seconds (not wall time). */
export function specDurations(records, identity) {
  const durations = new Map()
  for (const record of records) {
    for (const suite of record.suites) {
      if (!sameIdentity(suite.identity ?? record.identity, identity) || suite.code !== 0) continue
      const files = new Map()
      for (const test of suite.tests?.cases ?? []) {
        if (test.file && test.durationMs > 0) files.set(test.file, (files.get(test.file) ?? 0) + test.durationMs / 1000)
      }
      for (const [file, seconds] of files) if (!durations.has(file)) durations.set(file, seconds)
    }
  }
  return durations
}

/** Keep the old latest result during migration, then atomically replace it. */
export function writeRecord(status, runId, summary) {
  const latest = join(status, 'verify-main.json')
  const archive = (id, record) => {
    const folder = join(status, 'verify-main', 'commits', record.commit)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`)
  }
  if (existsSync(latest)) {
    const previous = JSON.parse(readFileSync(latest, 'utf8'))
    if (/^[a-f0-9]{40}$/.test(previous.commit) && typeof previous.finishedAt === 'string') {
      archive(`saved-${previous.finishedAt.replace(/[^a-zA-Z0-9]/g, '')}`, previous)
    }
  }
  archive(runId, summary)
  const temporary = `${latest}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(summary, null, 2)}\n`)
  renameSync(temporary, latest)
}

if (import.meta.main) {
  const [file, suite, category, ...evidence] = process.argv.slice(2)
  if (!file || !suite || !category || evidence.length === 0) throw new Error('usage: bun scripts/verify-records.mjs <record.json> <suite> <product|test|infrastructure|cancellation> <evidence>')
  classifyRecord(resolve(file), suite, category, evidence.join(' '), statusFolder(resolve(import.meta.dirname, '..')))
}

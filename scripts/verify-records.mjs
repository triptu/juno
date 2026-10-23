import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sameIdentity } from './verify-inputs.mjs'

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

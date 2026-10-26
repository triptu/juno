/**
 * Counts the SQL the engine runs in this process (docs/performance.md,
 * "Counted budgets"): statements executed and rows they returned, in total
 * and by statement text, so a failed budget names the statement that grew.
 * It wraps `node:sqlite`'s statement methods once, on top of the preload's
 * wrapper; counting is a few increments per statement.
 *
 * Counts are process-wide. Take them at rest (`quiet`) around one operation,
 * with no other engine running, so they hold only that operation's work.
 */
import { StatementSync } from 'node:sqlite'

export interface SqlWork {
  readonly statements: number
  readonly rows: number
  /** Executions and rows by statement text, the most executed first. */
  readonly byStatement: ReadonlyArray<{ readonly sql: string; readonly runs: number; readonly rows: number }>
}

const runs = new Map<string, { runs: number; rows: number }>()

const record = (sql: string, rows: number) => {
  const entry = runs.get(sql)
  if (entry === undefined) runs.set(sql, { runs: 1, rows })
  else {
    entry.runs++
    entry.rows += rows
  }
}

const installed = Symbol.for('juno.sqlWork')
const prototype = StatementSync.prototype as unknown as Record<'run' | 'get' | 'all' | 'iterate', (...parameters: Array<unknown>) => unknown> & { [installed]?: true }
if (prototype[installed] !== true) {
  prototype[installed] = true
  const { run, get, all, iterate } = prototype
  prototype.run = function (this: StatementSync, ...parameters) {
    record(this.sourceSQL, 0)
    return run.apply(this, parameters)
  }
  prototype.get = function (this: StatementSync, ...parameters) {
    const row = get.apply(this, parameters)
    record(this.sourceSQL, row === undefined ? 0 : 1)
    return row
  }
  prototype.all = function (this: StatementSync, ...parameters) {
    const rows = all.apply(this, parameters) as ReadonlyArray<unknown>
    record(this.sourceSQL, rows.length)
    return rows
  }
  prototype.iterate = function (this: StatementSync, ...parameters) {
    const sql = this.sourceSQL
    const rows = iterate.apply(this, parameters) as Iterable<unknown>
    return (function* () {
      let count = 0
      try {
        for (const row of rows) {
          count++
          yield row
        }
      } finally {
        record(sql, count)
      }
    })()
  }
}

const snapshot = () => new Map([...runs].map(([sql, entry]) => [sql, { ...entry }]))

/** Runs `operation` and returns the SQL it ran, with what it returned. */
export async function countSql<A>(operation: () => Promise<A>): Promise<{ readonly value: A; readonly sql: SqlWork }> {
  const before = snapshot()
  const value = await operation()
  const byStatement: Array<{ sql: string; runs: number; rows: number }> = []
  for (const [sql, entry] of runs) {
    const was = before.get(sql)
    const delta = { sql: sql.replace(/\s+/g, ' ').trim(), runs: entry.runs - (was?.runs ?? 0), rows: entry.rows - (was?.rows ?? 0) }
    if (delta.runs > 0) byStatement.push(delta)
  }
  byStatement.sort((a, b) => b.runs - a.runs || b.rows - a.rows)
  return {
    value,
    sql: {
      statements: byStatement.reduce((sum, entry) => sum + entry.runs, 0),
      rows: byStatement.reduce((sum, entry) => sum + entry.rows, 0),
      byStatement,
    },
  }
}

/** Statements executed in this process so far, for telling when work has stopped. */
export const statementsSoFar = (): number => {
  let total = 0
  for (const entry of runs.values()) total += entry.runs
  return total
}

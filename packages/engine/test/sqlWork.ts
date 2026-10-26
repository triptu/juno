/**
 * Counts the SQL one engine runs (docs/performance.md, "Counted budgets"):
 * statements executed and rows they returned, in total and by statement text,
 * so a failed budget names the statement that grew. It wraps `node:sqlite`'s
 * `prepare` and statement methods once, on top of the preload's wrapper;
 * counting is a few increments per statement.
 *
 * Counts are kept by database file, and a count reads only the files in one
 * engine's user-data folder, so SQL that another engine, the agent or work
 * left over from an earlier file in the same test process runs is not in it.
 * Take counts at rest (`quiet`) around one operation.
 */
import { realpathSync } from 'node:fs'
import { sep } from 'node:path'
import { DatabaseSync, StatementSync } from 'node:sqlite'

export interface SqlWork {
  readonly statements: number
  readonly rows: number
  /** Executions and rows by statement text, the most executed first. */
  readonly byStatement: ReadonlyArray<{ readonly sql: string; readonly runs: number; readonly rows: number }>
}

/** By database file, then by statement text. */
type Runs = Map<string, Map<string, { runs: number; rows: number }>>

type Methods = Record<'run' | 'get' | 'all' | 'iterate' | 'prepare', (...parameters: Array<unknown>) => unknown>
const installed = Symbol.for('juno.sqlWork')
/** The prototype that defines `name`, so the wrapper sits under the preload's subclass and is installed once per process. */
const owner = (prototype: object, name: string): Methods & { [installed]?: Runs } => {
  let at = prototype
  while (!Object.hasOwn(at, name)) at = Object.getPrototypeOf(at) as object
  return at as Methods & { [installed]?: Runs }
}
const statements = owner(StatementSync.prototype, 'run')
const databases = owner(DatabaseSync.prototype, 'prepare')

// Kept on the prototype, so a second load of this module (a fresh global under `--isolate`) neither wraps twice nor reads a map nothing feeds.
const runs: Runs = statements[installed] ?? new Map()
if (statements[installed] === undefined) {
  statements[installed] = runs
  /** The database file each statement runs on. */
  const files = new WeakMap<object, string>()
  const record = (file: string, sql: string, rows: number) => {
    let bySql = runs.get(file)
    if (bySql === undefined) runs.set(file, (bySql = new Map()))
    const entry = bySql.get(sql)
    if (entry === undefined) bySql.set(sql, { runs: 1, rows })
    else {
      entry.runs++
      entry.rows += rows
    }
  }
  const { prepare } = databases
  databases.prepare = function (this: DatabaseSync, ...parameters) {
    const statement = prepare.apply(this, parameters) as object
    files.set(statement, this.location() ?? '')
    return statement
  }
  const { run, get, all, iterate } = statements
  statements.run = function (this: StatementSync, ...parameters) {
    record(files.get(this) ?? '', this.sourceSQL, 0)
    return run.apply(this, parameters)
  }
  statements.get = function (this: StatementSync, ...parameters) {
    const row = get.apply(this, parameters)
    record(files.get(this) ?? '', this.sourceSQL, row === undefined ? 0 : 1)
    return row
  }
  statements.all = function (this: StatementSync, ...parameters) {
    const rows = all.apply(this, parameters) as ReadonlyArray<unknown>
    record(files.get(this) ?? '', this.sourceSQL, rows.length)
    return rows
  }
  statements.iterate = function (this: StatementSync, ...parameters) {
    const sql = this.sourceSQL
    const file = files.get(this) ?? ''
    const rows = iterate.apply(this, parameters) as Iterable<unknown>
    return (function* () {
      let count = 0
      try {
        for (const row of rows) {
          count++
          yield row
        }
      } finally {
        record(file, sql, count)
      }
    })()
  }
}

/** Runs `operation` and returns the SQL it ran on the databases in the folder `folderOf` names (an engine's `userData`), with what it returned. */
export async function countSql<A>(operation: () => Promise<A>, folderOf: (value: A) => string): Promise<{ readonly value: A; readonly sql: SqlWork }> {
  // Every file's counts as they stand: the folder may not exist until the operation creates it.
  const before = new Map([...runs].map(([file, bySql]) => [file, new Map([...bySql].map(([sql, entry]) => [sql, { ...entry }]))]))
  const value = await operation()
  const prefix = realpathSync(folderOf(value)) + sep
  const byStatement: Array<{ sql: string; runs: number; rows: number }> = []
  const totals = new Map<string, { runs: number; rows: number }>()
  for (const [file, bySql] of runs) {
    if (!file.startsWith(prefix)) continue
    for (const [sql, entry] of bySql) {
      const was = before.get(file)?.get(sql)
      const sum = totals.get(sql) ?? { runs: 0, rows: 0 }
      totals.set(sql, { runs: sum.runs + entry.runs - (was?.runs ?? 0), rows: sum.rows + entry.rows - (was?.rows ?? 0) })
    }
  }
  for (const [sql, delta] of totals) if (delta.runs > 0) byStatement.push({ sql: sql.replace(/\s+/g, ' ').trim(), ...delta })
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

/** Statements executed so far on the databases inside `folder`, for telling when an engine's work has stopped. */
export const statementsSoFar = (folder: string): number => {
  const prefix = realpathSync(folder) + sep
  let total = 0
  for (const [file, bySql] of runs) if (file.startsWith(prefix)) for (const entry of bySql.values()) total += entry.runs
  return total
}

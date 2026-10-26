/**
 * Preloaded into every `bun test` run (root and package `bunfig.toml`).
 *
 * The app runs its SQLite store on Electron's Node; the unit tests run it on
 * Bun. Bun's `node:sqlite` differs from Electron 44's Node 24 in ways that stop
 * the store from working, so this file makes it behave as Node does:
 *
 * - On macOS Bun uses the system SQLite, which cannot open a WAL database
 *   read-only when its `-shm` file is missing (the store does that to read the
 *   cache's epoch) and has no extension support. Electron bundles its own
 *   SQLite, which can. So the tests load a full SQLite: `JUNO_SQLITE`, else
 *   Homebrew's (`brew install sqlite`). On Linux Bun bundles its own.
 * - `@effect/sql-sqlite-node` opens with `allowExtension: true` and then
 *   switches loading off with `enableLoadExtension(false)`. Juno loads no
 *   extension, so the option is dropped and loading stays off, as on Node.
 * - Node binds `true` and `false` as the integers 1 and 0; Bun refuses them.
 *   They are converted, positional and named alike. `undefined` is left alone:
 *   Electron's Node 24 refuses it, and so does Bun.
 *
 * `packages/store/test/node-sqlite.test.ts` pins this behaviour, as observed on Electron 44.
 */
import { Database } from 'bun:sqlite'
import { mock, setDefaultTimeout } from 'bun:test'
import { existsSync } from 'node:fs'

// Process kills and snapshot restores cannot discard the drive cache. Keep WAL + FULL,
// but skip macOS's hardware flush in tests and their children. Set 1 to use the app settings.
process.env.JUNO_TEST_FULLFSYNC ??= '0'

// A test that boots an engine against the fake Slack waits on real I/O. The harness's own waits
// (`WAIT_MS` in packages/engine/test/harness.ts) are half of this, so a slow step fails with its label.
// A preload runs once per Bun process, and this reaches only the first file the process runs, so the
// test scripts (scripts/unit.mjs, each package's `test`) also pass `--timeout=30000`.
setDefaultTimeout(30_000)

const fullSqlite =
  process.platform !== 'darwin'
    ? undefined
    : [process.env.JUNO_SQLITE, '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', '/usr/local/opt/sqlite/lib/libsqlite3.dylib'].find(
        (path) => path !== undefined && path !== '' && existsSync(path),
      )
if (fullSqlite !== undefined) Database.setCustomSQLite(fullSqlite)
const missingSqlite = process.platform === 'darwin' && fullSqlite === undefined

const sqlite = await import('node:sqlite')

// As integers, as Node binds them (a JS number binds as a real).
const bindable = (value: unknown) => (typeof value === 'boolean' ? (value ? 1n : 0n) : value)

const nodeParameters = (parameters: Array<unknown>) =>
  parameters.map((parameter, index) =>
    // Node reads a plain object in first place as named parameters.
    index === 0 && parameter !== null && typeof parameter === 'object' && Object.getPrototypeOf(parameter) === Object.prototype
      ? Object.fromEntries(Object.entries(parameter).map(([name, value]) => [name, bindable(value)]))
      : bindable(parameter),
  )

const statement = sqlite.StatementSync.prototype as unknown as Record<'run' | 'get' | 'all' | 'iterate', (...parameters: Array<unknown>) => unknown>
for (const method of ['run', 'get', 'all', 'iterate'] as const) {
  const original = statement[method]
  statement[method] = function (this: unknown, ...parameters: Array<unknown>) {
    return original.apply(this, nodeParameters(parameters))
  }
}

class DatabaseSync extends sqlite.DatabaseSync {
  constructor(path: ConstructorParameters<typeof sqlite.DatabaseSync>[0], options?: ConstructorParameters<typeof sqlite.DatabaseSync>[1]) {
    if (missingSqlite) throw new Error('The store tests need a full SQLite on macOS: run `brew install sqlite`, or set JUNO_SQLITE to a libsqlite3.dylib.')
    const { allowExtension: _, ...rest } = options ?? {}
    super(path, rest)
  }
}

const nodeSqlite = { ...sqlite, DatabaseSync }
mock.module('node:sqlite', () => ({ ...nodeSqlite, default: nodeSqlite }))

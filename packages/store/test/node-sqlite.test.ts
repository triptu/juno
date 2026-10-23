// What the store needs from `node:sqlite`, as Electron 44's Node 24 (SQLite 3.53.4)
// behaves. The app runs on Electron; these tests run on Bun through the preload in
// packages/testing/src/preload.ts. If Bun or the preload drifts from Electron, this
// file fails before any store test misleads.
import { expect, it } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

async function withDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'juno-node-sqlite-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

it('binds booleans as 1 and 0, refuses undefined, and keeps extension loading off', () => {
  const db = new DatabaseSync(':memory:', { allowExtension: true })
  db.enableLoadExtension(false)
  db.exec('CREATE TABLE t (name TEXT, value)')
  db.prepare('INSERT INTO t VALUES (?, ?)').run('true', true as never)
  db.prepare('INSERT INTO t VALUES ($name, $value)').run({ $name: 'false', $value: false as never })
  expect(db.prepare('SELECT name, value, typeof(value) AS type FROM t ORDER BY name').all()).toEqual([
    { name: 'false', value: 0, type: 'integer' },
    { name: 'true', value: 1, type: 'integer' },
  ])
  expect(() => db.prepare('INSERT INTO t VALUES (?, ?)').run('undefined', undefined as never)).toThrow()
  expect(() => db.prepare('INSERT INTO t VALUES ($name, $value)').run({ $name: 'undefined', $value: undefined as never })).toThrow()
  expect(() => db.loadExtension('/nonexistent')).toThrow()
  db.close()
})

it('opens a WAL database read-only after its writer closed, has FTS5, and backs up', () =>
  withDir(async (dir) => {
    const file = join(dir, 'cache.db')
    const writer = new DatabaseSync(file)
    expect(writer.prepare('PRAGMA journal_mode = WAL').get()).toEqual({ journal_mode: 'wal' })
    writer.exec(`
      PRAGMA busy_timeout = 1000;
      CREATE VIRTUAL TABLE search USING fts5(text);
      INSERT INTO search VALUES ('staging deploy is green');
      PRAGMA user_version = 7;
    `)
    expect(writer.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 1000 })
    await backup(writer, join(dir, 'copy.db'))
    writer.close()
    expect(await readdir(dir)).not.toContain('cache.db-shm')

    const reader = new DatabaseSync(file, { readOnly: true })
    expect(reader.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 })
    expect(reader.prepare(`SELECT text FROM search WHERE search MATCH 'deploy'`).all()).toEqual([{ text: 'staging deploy is green' }])
    expect(() => reader.exec(`INSERT INTO search VALUES ('no')`)).toThrow()
    reader.close()
    const copy = new DatabaseSync(join(dir, 'copy.db'), { readOnly: true })
    expect(copy.prepare('SELECT count(*) AS n FROM search').get()).toEqual({ n: 1 })
    copy.close()
  }))

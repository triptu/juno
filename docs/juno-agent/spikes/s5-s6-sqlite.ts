// S5: a single-writer lock and FULL write rates. S6: the SQLite session extension for backup capture.
// Node has no flock, so the lock is an SQLite file held with locking_mode=EXCLUSIVE (a POSIX lock the
// kernel drops when the process dies).
// Run under Electron's Node (what the utility process runs):
//   ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/.bin/electron docs/juno-agent/spikes/s5-s6-sqlite.ts
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function takeLock(path: string) {
  const db = new DatabaseSync(path, { timeout: 0 })
  db.exec('PRAGMA locking_mode = EXCLUSIVE')
  db.exec('CREATE TABLE IF NOT EXISTS owner (pid INTEGER)')
  db.exec('BEGIN EXCLUSIVE')
  db.exec(`INSERT INTO owner VALUES (${process.pid})`)
  db.exec('COMMIT')
  return db
}

function tryLock(path: string): { ok: boolean; db?: DatabaseSync; error?: string } {
  try {
    return { ok: true, db: takeLock(path) }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

if (process.argv[2] === 'holder') {
  // Keep the connection referenced: a collected DatabaseSync closes and drops the lock.
  ;(globalThis as { lock?: DatabaseSync }).lock = takeLock(process.argv[3]!)
  process.stdout.write('LOCKED\n')
  setInterval(() => {}, 1000)
} else {
  const dir = mkdtempSync(join(tmpdir(), 'juno-s5-'))
  try {
    console.log(`runtime: node ${process.versions.node}${process.versions.electron ? `, electron ${process.versions.electron}` : ''}`)

    // S5a: lock held by another process, refused here, granted after kill -9.
    const lockPath = join(dir, 'owner.lock')
    const holder = spawn(process.execPath, [process.argv[1]!, 'holder', lockPath], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env })
    await new Promise<void>((resolve) => holder.stdout.on('data', (d: Buffer) => d.toString().includes('LOCKED') && resolve()))
    const refused = tryLock(lockPath)
    console.log(`lock while another process holds it: ${refused.ok ? 'GRANTED (bad)' : `refused (${refused.error})`}`)
    holder.kill('SIGKILL')
    await new Promise((resolve) => holder.on('exit', resolve))
    const granted = tryLock(lockPath)
    console.log(`lock after the holder was killed: ${granted.ok ? 'granted' : `refused (${granted.error})`}`)
    granted.db?.close()

    // S5b: single-row write transactions at NORMAL and FULL.
    // On macOS, fsync does not flush the drive's cache; only fullfsync (F_FULLFSYNC) survives power loss.
    for (const [mode, fullfsync] of [['NORMAL', 'OFF'], ['FULL', 'OFF'], ['FULL', 'ON']]) {
      const db = new DatabaseSync(join(dir, `rate-${mode}-${fullfsync}.sqlite`))
      db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = ${mode}; PRAGMA fullfsync = ${fullfsync}; PRAGMA checkpoint_fullfsync = ${fullfsync}`)
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, body TEXT)')
      const insert = db.prepare('INSERT INTO t (body) VALUES (?)')
      const body = 'x'.repeat(512)
      const n = fullfsync === 'ON' ? 200 : 2000
      const start = performance.now()
      for (let i = 0; i < n; i++) {
        db.exec('BEGIN IMMEDIATE')
        insert.run(body)
        db.exec('COMMIT')
      }
      const ms = performance.now() - start
      console.log(`synchronous=${mode} fullfsync=${fullfsync}: ${n} transactions in ${ms.toFixed(0)} ms (${((n / ms) * 1000).toFixed(0)}/s, ${(ms / n).toFixed(3)} ms each)`)
      db.close()
    }

    // S6: session extension: capture a changeset, apply it to a fresh database.
    const source = new DatabaseSync(join(dir, 'source.sqlite'))
    source.exec('CREATE TABLE inbox (op_id TEXT PRIMARY KEY, text TEXT, state TEXT)')
    const session = source.createSession()
    source.exec("INSERT INTO inbox VALUES ('op-1', 'hello', 'accepted'), ('op-2', 'world', 'accepted')")
    source.exec("UPDATE inbox SET state = 'submitted' WHERE op_id = 'op-1'")
    source.exec("DELETE FROM inbox WHERE op_id = 'op-2'")
    const changeset = session.changeset()
    session.close()
    const replica = new DatabaseSync(join(dir, 'replica.sqlite'))
    replica.exec('CREATE TABLE inbox (op_id TEXT PRIMARY KEY, text TEXT, state TEXT)')
    const applied = replica.applyChangeset(changeset)
    const rows = replica.prepare('SELECT * FROM inbox ORDER BY op_id').all()
    console.log(`session extension: changeset ${changeset.byteLength} bytes, applied ${applied}, replica rows ${JSON.stringify(rows)}`)
    source.close()
    replica.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

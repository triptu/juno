/**
 * The Codex purge hook (plan v3 §4.5 step 3, §7.2). Codex reuses a thread within a bounded chat session, and the adapter records its thread id and home in
 * `codex_turns`. A removal deletes the session files of every recorded
 * thread: a turn does not record which archive messages its prompt held. Reuse
 * requires a recorded id, so clearing the ids also invalidates reuse. Kept apart from
 * `codex.ts` so the purge does not load the Codex SDK.
 */
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { stopCodexWriters } from './codex/lifecycle'
import { Schema } from 'effect'
import type { Store } from '../store/store'

/** Where Codex keeps a thread's files under its home. */
const SESSION_DIRS = ['sessions', 'archived_sessions']

async function files(dir: string): Promise<ReadonlyArray<string>> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
}

/**
 * Deletes the session files of every recorded Codex thread, then forgets the
 * thread ids. Idempotent: a crash part way leaves ids whose files are
 * partly gone, and the next call finishes them. Returns the files deleted.
 */
export async function purgeCodexThreads(store: Store): Promise<number> {
  const rows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String, home: Schema.String })))(
    store.db.prepare('SELECT id, home FROM codex_turns').all(),
  )
  let deleted = 0
  for (const home of new Set(rows.map((row) => row.home))) {
    await stopCodexWriters(home)
    for (const dir of SESSION_DIRS) {
      for (const file of await files(join(home, dir))) {
        // This dedicated home contains only Juno threads, including one that
        // crashed after writing its file but before reporting thread.started.
        await rm(file, { force: true })
        deleted += 1
      }
    }
  }
  const forget = store.db.prepare('UPDATE codex_turns SET thread_id = NULL WHERE id = ?')
  for (const row of rows) forget.run(row.id)
  return deleted
}

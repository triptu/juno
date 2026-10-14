/**
 * Recovery at open (plan v3 §3 steps 3 to 6, §6.5, G8; spec `openJournal`,
 * `rollbackJournal`, `rotate`, `startup`). The owner lock is held and
 * `agent.sqlite` is open before this runs.
 *
 * - The journal's last committed position, `next_seq - 1`, at or ahead of
 *   the archive cursor is normal: a crash between a journal commit and its
 *   projection leaves it ahead. pi resumes and projection catches up.
 * - Behind the cursor, the file is older than the archive: it was restored
 *   or rolled back. It is never resumed. Recovery rotates to a new
 *   incarnation and marks every submitted op whose run did not finish
 *   `interrupted`. A file that records another incarnation, or a missing
 *   file under a non-zero cursor, is handled the same way.
 * - Behind the position of the incarnation's latest authorization is
 *   handled the same way. The cursor alone misses a copy that lost only
 *   state commits, such as a tool call's execute intent; resuming it would
 *   run the call, and its effect, again.
 * - A schema newer than this pi supports stops with "Juno needs to update
 *   its records" and writes nothing.
 * - Before pi resumes, every open authorization becomes `unknown` (§6.5).
 */
import { classifyAtStartup } from '../store/ledger'
import type { Store } from '../store/store'
import { openJournalFile, type JournalFile } from '../runtime/journal'
import { commitRotation, deleteRetiredJournals, ensureIncarnation, resumeFloor } from './incarnations'

export type Recovery =
  /** The journal is at or ahead of the archive: resume it. */
  | { readonly _tag: 'resume'; readonly file: JournalFile; readonly classified: number }
  /** The journal was behind the archive (or foreign): a new incarnation, with nothing to resume. */
  | { readonly _tag: 'rotated'; readonly file: JournalFile; readonly classified: number; readonly from: string }
  /** The journal needs a newer Juno. Nothing was written. */
  | { readonly _tag: 'updateNeeded'; readonly version: number }

export async function recover(store: Store, agentDir: string): Promise<Recovery> {
  let incarnation = ensureIncarnation(store)
  deleteRetiredJournals(agentDir, incarnation)
  const opened = await openJournalFile(agentDir, incarnation)
  if (opened._tag === 'unsupported') return { _tag: 'updateNeeded', version: opened.version }
  const behind = opened._tag === 'foreign' || opened.file.lastCommitted < resumeFloor(store, incarnation)
  if (!behind && opened._tag === 'opened') {
    const classified = classifyAtStartup(store)
    return { _tag: 'resume', file: opened.file, classified }
  }
  if (opened._tag === 'opened') await opened.file.close()
  const from = incarnation
  incarnation = commitRotation(store, 'rollback')
  deleteRetiredJournals(agentDir, incarnation)
  const fresh = await openJournalFile(agentDir, incarnation)
  if (fresh._tag !== 'opened') throw new Error(`a new journal could not be opened (${fresh._tag})`)
  const classified = classifyAtStartup(store)
  return { _tag: 'rotated', file: fresh.file, classified, from }
}

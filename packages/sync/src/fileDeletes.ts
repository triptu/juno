/**
 * The files of a post Slack has not got, once the post is removed
 * (architecture 9, "Upload"). Each file the post uploaded and completed
 * (`fileId`), or uploaded with a completion whose answer was lost
 * (`uploadId`), is a private file in Slack that no message shows, so its
 * removal queues one `deleteFile` outbox row per file, keyed by the file's
 * id, and the engine's `ActionWorker` sends `files.delete`. A file another
 * pending row still names stays. A row already queued for the file is not
 * queued twice.
 */
import { StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import type { PendingFile } from './posts'

/** The file's id in Slack: the completed file, or an upload that may have completed. An upload never completed answers `file_deleted`, so deleting it is harmless. */
const slackIds = (file: PendingFile): ReadonlyArray<string> => {
  const id = file.fileId ?? file.uploadId
  return id === undefined ? [] : [id]
}

export const queueFileDeletes = (
  post: { readonly clientMsgId: string; readonly files: ReadonlyArray<PendingFile> },
  now: number,
): Effect.Effect<void, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const uploaded = post.files.flatMap(slackIds)
    if (uploaded.length === 0) return
    const sql = yield* StoreWriter
    const others = yield* sql<{ file_ids_json: string }>`SELECT file_ids_json FROM pending_messages WHERE client_msg_id != ${post.clientMsgId} AND file_ids_json IS NOT NULL`
    const named = new Set(others.flatMap((row) => (JSON.parse(row.file_ids_json) as ReadonlyArray<PendingFile>).flatMap(slackIds)))
    for (const fileId of uploaded) {
      if (named.has(fileId)) continue
      const payload = JSON.stringify({ ts: null, clientMsgId: post.clientMsgId, topics: [], fileId })
      yield* sql`INSERT INTO outbox (kind, target_key, payload_json, depends_on, created_at, next_at)
        SELECT 'deleteFile', ${fileId}, ${payload}, NULL, ${String(now)}, ${String(now)}
        WHERE NOT EXISTS (SELECT 1 FROM outbox WHERE kind = 'deleteFile' AND target_key = ${fileId})`
    }
  })

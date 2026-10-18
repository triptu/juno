import { Invalidation, StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { asMessageFile, hasThumbs, isReady, parseFiles, type FileJson } from '../files'
import { readMessage, writeMessage } from './messages'

/**
 * Writes the processed file a message re-read answered for `fileId` into the stored
 * messages `targets` name, over the copy each holds, so its thumbnails,
 * poster and size come with it. A message that no longer carries the file,
 * or already shows it, is left alone. An answer that is not ready either
 * changes nothing (the caller asks again).
 */
export const storeFileInfo = (
  fileId: string,
  info: FileJson,
  targets: ReadonlyArray<{ readonly channel: string; readonly ts: string }>,
): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (!isReady(info)) return
    const fresh = asMessageFile(info)
    for (const target of targets) {
      const row = yield* readMessage(target.channel, target.ts)
      const files = parseFiles(row?.files_json ?? null)
      if (row === undefined || files === undefined) continue
      let changed = false
      const next = files.map((file) => {
        if (file['id'] !== fileId || isReady(file)) return file
        changed = true
        return { ...file, ...fresh }
      })
      if (changed) yield* writeMessage({ ...row, files_json: JSON.stringify(next), version: row.version + 1 })
    }
    // Slack's thumbnails replace the sender's local copy (`posts.ts`, `uploaded_files`).
    if (hasThumbs(info)) {
      const sql = yield* StoreWriter
      yield* sql`DELETE FROM uploaded_files WHERE file_id = ${fileId}`
    }
  })

import { Invalidation, StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import { hasThumbs, parseFiles, thumbsOf, type FileJson } from '../files'
import { readMessage, writeMessage } from './messages'

/**
 * Writes the thumbnails `files.info` answered for `fileId` into the stored
 * messages `targets` name. A message that no longer carries the file, or
 * already has its thumbnails, is left alone.
 */
export const storeFileThumbs = (
  fileId: string,
  info: FileJson,
  targets: ReadonlyArray<{ readonly channel: string; readonly ts: string }>,
): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    if (!hasThumbs(info)) return
    const thumbs = thumbsOf(info)
    for (const target of targets) {
      const row = yield* readMessage(target.channel, target.ts)
      const files = parseFiles(row?.files_json ?? null)
      if (row === undefined || files === undefined) continue
      let changed = false
      const next = files.map((file) => {
        if (file['id'] !== fileId || hasThumbs(file)) return file
        changed = true
        return { ...file, ...thumbs }
      })
      if (changed) yield* writeMessage({ ...row, files_json: JSON.stringify(next), version: row.version + 1 })
    }
    // Slack's thumbnails replace the sender's local copy (`posts.ts`, `uploaded_files`).
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM uploaded_files WHERE file_id = ${fileId}`
  })

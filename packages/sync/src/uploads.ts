/**
 * A queued post's files on their way to Slack (architecture 9, "Upload"):
 * what the row keeps of each upload, and the staged copies a sent image
 * still shows. `posts.ts` owns the row itself.
 */
import { StoreWriter, type SqlError } from '@juno/store'
import { Clock, Effect } from 'effect'
import { KEEP_MILLIS, readPost, type PendingFile } from './posts'

/**
 * One of a queued post's files is in Slack: its id is kept, so the next
 * try uploads only the files still missing. False when the row is gone.
 */
export const fileUploaded = (clientMsgId: string, stagedId: string, fileId: string): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const post = yield* readPost(clientMsgId)
    if (post === undefined) return false
    const files = post.files.map((file) => (file.id === stagedId ? { ...withoutUpload(file), fileId } : file))
    const sql = yield* StoreWriter
    yield* sql`UPDATE pending_messages SET file_ids_json = ${JSON.stringify(files)} WHERE client_msg_id = ${clientMsgId}`
    // An image keeps its staged copy as the message's preview until Slack's thumbnails are stored (`files.ts`).
    const staged = files.find((file) => file.id === stagedId)
    if (staged?.width !== undefined && staged.height !== undefined && staged.mimetype.startsWith('image/') && !staged.stagedName.endsWith('.bin')) {
      const now = yield* Clock.currentTimeMillis
      yield* sql`DELETE FROM uploaded_files WHERE uploaded_at < ${now - KEEP_MILLIS}`
      yield* sql`INSERT INTO uploaded_files (file_id, staged_name, width, height, uploaded_at) VALUES (${fileId}, ${staged.stagedName}, ${staged.width}, ${staged.height}, ${now})
        ON CONFLICT (file_id) DO NOTHING`
    }
    return true
  })

const withoutUpload = (file: PendingFile): PendingFile => {
  const { uploadId: _, ...rest } = file
  return rest
}

/**
 * Slack has the bytes of a queued post's file under `uploadId`, and
 * `files.completeUpload` has not answered yet; undefined forgets an upload
 * Slack refused to complete, so the file goes up again. False when the row
 * is gone.
 */
export const fileUploading = (clientMsgId: string, stagedId: string, uploadId: string | undefined): Effect.Effect<boolean, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const post = yield* readPost(clientMsgId)
    if (post === undefined) return false
    const files = post.files.map((file) => (file.id !== stagedId ? file : uploadId === undefined ? withoutUpload(file) : { ...file, uploadId }))
    const sql = yield* StoreWriter
    yield* sql`UPDATE pending_messages SET file_ids_json = ${JSON.stringify(files)} WHERE client_msg_id = ${clientMsgId}`
    return true
  })

/** The staged copies `uploaded_files` still shows, which the staging sweep keeps. */
export const uploadedNames: Effect.Effect<ReadonlyArray<string>, SqlError, StoreWriter> = Effect.gen(function* () {
  const sql = yield* StoreWriter
  return (yield* sql<{ staged_name: string }>`SELECT staged_name FROM uploaded_files`).map((row) => row.staged_name)
})

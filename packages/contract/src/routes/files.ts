/**
 * Attachments (spec section 8; architecture 9).
 *
 * The composer stages each file it is given (paste, drop, the attach
 * button) as soon as it is attached: the renderer reads the bytes and sends
 * them in chunks of at most `STAGE_CHUNK_BYTES` (performance 2.2), and the
 * engine writes them under the workspace's `uploads/` folder. A staged file
 * is a chip; `messages.send` names the staged files that go with the text,
 * and the outbox uploads them to Slack before it posts (architecture 5.7).
 *
 * - `files.stage`: one chunk of a file, in order. The last chunk answers
 *   the `StagedFile` the chip shows.
 * - `files.unstage`: the chip was removed before sending; the bytes go.
 * - `uploads.progress`: how far the uploads of the messages being sent
 *   have got, for the pending rows.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotSignedIn, Rejected } from '../errors'
import { liveValueRoute } from '../live'

/** The largest chunk `files.stage` takes. */
export const STAGE_CHUNK_BYTES = 1024 * 1024
/** Files one message carries at most, as in Slack's composer. */
export const MAX_FILES_PER_MESSAGE = 10
/** The largest file Slack takes (1 GiB). */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024

/** A file ready to go with a message: what its chip shows. */
export const StagedFile = Schema.Struct({
  /** The renderer's id for the file, a UUID. */
  id: Schema.String,
  name: Schema.String,
  mimetype: Schema.String,
  /** Bytes. */
  size: Schema.Number,
  /** An image's pixel size, read from its header. */
  width: Schema.optionalKey(Schema.Int),
  height: Schema.optionalKey(Schema.Int),
  /** `juno://uploads/<file>` for an image, which main serves from the staging folder. */
  preview: Schema.optionalKey(Schema.String),
})
export type StagedFile = typeof StagedFile.Type

/** Why a composer could not stage a file. Also the safe reason written to the app log. */
export const AttachmentFailure = Schema.Literals(['read_error', 'not_signed_in', 'bad_chunk', 'file_too_large', 'connection_error', 'engine_error'])
export type AttachmentFailure = typeof AttachmentFailure.Type

export const StageError = Schema.Union([NotSignedIn, Rejected])
export type StageError = typeof StageError.Type

/**
 * One chunk of a file at `offset`. Chunks come in order, starting at 0.
 * With `last` the file is complete and the answer is its `StagedFile`;
 * before that the answer is `null`. `Rejected` `file_too_large` above
 * `MAX_FILE_BYTES`, `bad_chunk` for a chunk out of order. `size` is the
 * whole file's, sent with the first chunk, so a message sent before the
 * last chunk shows it.
 */
export const filesStage = Rpc.make('files.stage', {
  payload: {
    id: Schema.String,
    name: Schema.String,
    mimetype: Schema.String,
    offset: Schema.Number,
    size: Schema.optionalKey(Schema.Number),
    bytes: Schema.Uint8Array,
    last: Schema.Boolean,
  },
  success: Schema.NullOr(StagedFile),
  error: StageError,
})

/**
 * A chip was removed before sending: its staged bytes are deleted. Unknown
 * ids are ignored. For a file a send took while it was still staging, it
 * says the rest of the bytes will not come, and the post fails.
 */
export const filesUnstage = Rpc.make('files.unstage', { payload: { id: Schema.String }, success: Schema.Void })

/** Upload progress of each message being sent with files, by `clientMsgId`, from 0 to 1. A message absent here is not uploading. */
export const UploadProgress = Schema.Record(Schema.String, Schema.Number)
export type UploadProgress = typeof UploadProgress.Type

export const uploadsProgress = liveValueRoute('uploads.progress', { value: UploadProgress })

export const FilesRoutes = RpcGroup.make(filesStage, filesUnstage, uploadsProgress)

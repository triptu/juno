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

/**
 * A thumbnail the view can show at once with `aspect-ratio: width / height`
 * (performance 3.3: late images never move what the user reads).
 * `src` is `juno://files/<file id>/<variant>?url=<encoded Slack thumb url>`:
 * main serves it from the Slack session (architecture 9) and fetches only
 * Slack file hosts.
 */
export const FileThumb = Schema.Struct({ src: Schema.String, width: Schema.Int, height: Schema.Int })
export type FileThumb = typeof FileThumb.Type

export const FileKind = Schema.Literals(['image', 'video', 'audio', 'pdf', 'html', 'text', 'file', 'deleted'])
export type FileKind = typeof FileKind.Type

/** How the viewer draws a `text` file (`@juno/domain` `fileTextKind`). */
export const FileTextKind = Schema.Literals(['markdown', 'csv', 'json', 'code', 'plain'])
export type FileTextKind = typeof FileTextKind.Type

/**
 * A file on a message. An image has `thumb` when Slack made one; an image
 * without dimensions is a card of fixed height. `audio`, `pdf`, `html` and
 * `text` files are cards that open in the media viewer; `file` is a card
 * with Quick Look. `deleted` is a file Slack no longer serves. `@juno/domain`
 * `fileMediaKind` decides the kind.
 */
export const FileView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: FileKind,
  mimetype: Schema.optionalKey(Schema.String),
  /** Bytes. */
  size: Schema.optionalKey(Schema.Number),
  /** The original's dimensions, when Slack knows them. */
  width: Schema.optionalKey(Schema.Int),
  height: Schema.optionalKey(Schema.Int),
  thumb: Schema.optionalKey(FileThumb),
  /** An image at full size for the viewer, a `juno://files` url like `thumb.src`. */
  full: Schema.optionalKey(Schema.String),
  /** A video the viewer plays, a `juno://files/<id>/video` url main streams from Slack. `thumb` is its poster. */
  video: Schema.optionalKey(Schema.String),
  /** An audio file or voice clip the player plays, a `juno://files/<id>/audio` url main streams from Slack, and its length when Slack gives it. */
  audio: Schema.optionalKey(Schema.String),
  durationMs: Schema.optionalKey(Schema.Number),
  /** A pdf, html or text file as Slack serves it, a `juno://files/<id>/content/<name>` url, for the viewer. */
  content: Schema.optionalKey(Schema.String),
  /** How the viewer draws a `text` file; for code its language as a reader names it ("Python"); its lines when Slack counted them (a snippet). */
  textKind: Schema.optionalKey(FileTextKind),
  language: Schema.optionalKey(Schema.String),
  lines: Schema.optionalKey(Schema.Int),
  /** Slack's download url, which main fetches on the Slack session. Absent for a file still being sent. */
  download: Schema.optionalKey(Schema.String),
})
export type FileView = typeof FileView.Type

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

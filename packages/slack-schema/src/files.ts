/**
 * The upload flow the official web client uses for files attached in the
 * composer:
 *
 * 1. `files.getUploadURL` gives an `upload_url` and the new file id.
 * 2. The bytes go to `upload_url` as `multipart/form-data` with one field
 *    named `file`. No token, no cookie. Success is HTTP 200.
 * 3. `files.completeUpload` finishes the upload, with no channel.
 * 4. `files.share` posts the message that carries the files.
 *
 * Source: the client's `getUploadURL`, `completeUpload` and `shareFile`
 * fetchers in `shared-boot-async` (modules `HExl` and `bw5L`), and its form
 * builder `getFormData` (`qVKj`). The client does not read the answers of
 * steps 3 and 4, so their fields are optional.
 *
 * `files.info` answers the file as Slack holds it now, with its thumbnails
 * once Slack has made them.
 */
import { Schema as S } from 'effect'
import { Blocks } from './blocks.ts'
import { FormBoolean, FormJson, FormList, FormNumber } from './common.ts'
import { Ts } from './ts.ts'
import { File } from './message.ts'

const opt = S.optionalKey

export const FilesGetUploadUrlArgs = S.Struct({
  filename: S.String,
  length: FormNumber,
  alt_txt: opt(S.String),
  snippet_type: opt(S.String),
  subtype: opt(S.String),
  client_context_team_id: opt(S.String),
})
export type FilesGetUploadUrlArgs = typeof FilesGetUploadUrlArgs.Type

/** `file` is the new file id (`F…`). */
export const FilesGetUploadUrlFields = { upload_url: S.String, file: S.String } as const

export const FilesCompleteUploadArgs = S.Struct({
  files: FormJson(S.Array(S.Struct({ id: S.String, title: opt(S.String), subtype: opt(S.String) }))),
})
export type FilesCompleteUploadArgs = typeof FilesCompleteUploadArgs.Type

export const FilesCompleteUploadFields = { files: opt(S.Array(File)) } as const

export const FilesShareArgs = S.Struct({
  /** File ids. The client passes an array to its form builder, which sends it comma-joined. */
  files: FormList,
  channel: S.String,
  thread_ts: opt(Ts),
  broadcast: opt(FormBoolean),
  blocks: opt(FormJson(Blocks)),
  /** Plain text, sent only when there are no blocks. */
  comment: opt(S.String),
  client_msg_id: S.String,
  resharing_aware: opt(FormBoolean),
  skip_dlp_user_warning: opt(FormBoolean),
  from_share_modal: opt(FormBoolean),
})
export type FilesShareArgs = typeof FilesShareArgs.Type

/** Live, the answer is `{ ok, file_msg_ts }`; the files come back without thumbnails on the message echo (research section 3). */
export const FilesShareFields = { files: opt(S.Array(File)), file_msg_ts: opt(Ts) } as const

export const FilesInfoArgs = S.Struct({ file: S.String })
export type FilesInfoArgs = typeof FilesInfoArgs.Type

/** Also `comments` and `paging`, which Juno does not read. */
export const FilesInfoFields = { file: File } as const

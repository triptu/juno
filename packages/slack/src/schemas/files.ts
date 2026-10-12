/**
 * The public upload pair: `files.getUploadURLExternal`, a raw POST of the bytes
 * to `upload_url`, then `files.completeUploadExternal` which posts the message.
 *
 * Whether an `xoxc` session may use this pair is an open question
 * (architecture section 9); the fake implements it as documented publicly.
 */
import { Schema as S } from 'effect'
import { Blocks } from './blocks'
import { FormJson, FormNumber, Ts } from './common'
import { File } from './message'

const opt = S.optionalKey

export const FilesGetUploadUrlArgs = S.Struct({
  filename: S.String,
  length: FormNumber,
  alt_txt: opt(S.String),
  snippet_type: opt(S.String),
})
export type FilesGetUploadUrlArgs = typeof FilesGetUploadUrlArgs.Type

export const FilesGetUploadUrlFields = { upload_url: S.String, file_id: S.String } as const

export const FilesCompleteUploadArgs = S.Struct({
  files: FormJson(S.Array(S.Struct({ id: S.String, title: opt(S.String) }))),
  channel_id: opt(S.String),
  thread_ts: opt(Ts),
  initial_comment: opt(S.String),
  blocks: opt(FormJson(Blocks)),
})
export type FilesCompleteUploadArgs = typeof FilesCompleteUploadArgs.Type

export const FilesCompleteUploadFields = { files: S.Array(File) } as const

/**
 * Staging attached files (architecture 9): each file's bytes go to the
 * engine in chunks of at most `STAGE_CHUNK_BYTES` (`files.stage`). Apart
 * from `attachments.ts` so the renderer can load it when a file is first
 * attached, not with the first bundle.
 */
import { filesStage, filesUnstage, MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE, STAGE_CHUNK_BYTES, type StagedFile, type AttachmentFailure } from '@juno/contract'
import type { JunoBridge } from '@juno/contract/channels'
import { errorOf } from './result'
import { attachedFiles, attachmentsAtom, firstChunks, update, type Attachment } from './attachments'
import { runCommand } from './atoms'
import type { Registry } from './client'

/** The part of a DOM `File` staging reads; the state package has no DOM types. */
export interface FileLike {
  readonly name: string
  readonly size: number
  readonly type: string
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

declare const window: { readonly juno: JunoBridge }

const fromStaged = (staged: StagedFile): Partial<Attachment> => ({ state: 'ready', size: staged.size, mimetype: staged.mimetype, preview: staged.preview })

/** A pasted image has no useful name ("image.png" from Chromium); the official client sends what Chromium gives, and so does Juno. */
const nameOf = (file: FileLike) => (file.name.trim() === '' ? 'Untitled' : file.name)

/**
 * Adds `files` to the composer of `key` and stages them. Files beyond
 * `MAX_FILES_PER_MESSAGE`, empty files and files over `MAX_FILE_BYTES` are
 * left out, as Slack's composer does. Resolves once every file is staged
 * or failed.
 */
export async function attachFiles(registry: Registry, key: string, files: ReadonlyArray<FileLike>): Promise<void> {
  const room = MAX_FILES_PER_MESSAGE - registry.get(attachmentsAtom(key)).length
  const taken = files.filter((file) => file.size > 0 && file.size <= MAX_FILE_BYTES).slice(0, Math.max(0, room))
  const added = taken.map((file) => ({ file, attachment: { id: crypto.randomUUID(), name: nameOf(file), size: file.size, mimetype: file.type || 'application/octet-stream', state: 'staging' as const } }))
  if (added.length === 0) return
  for (const { file, attachment } of added) attachedFiles.set(attachment.id, file)
  update(registry, key, (current) => [...current, ...added.map((each) => each.attachment)])
  await Promise.all(
    added.map(async ({ file, attachment }) => {
      const staged = await stage(registry, attachment, file).finally(() => firstChunks.delete(attachment.id))
      const removed = !registry.get(attachmentsAtom(key)).some((each) => each.id === attachment.id)
      // The chip went while its bytes were on the way. Removed: they go too. Sent: the engine keeps a file it has,
      // and fails the post of one it will not get.
      if (removed) return void runCommand(registry, filesUnstage, { id: attachment.id })
      update(registry, key, (current) => current.map((each) => (each.id === attachment.id ? { ...each, ...(staged.state === 'failed' ? staged : fromStaged(staged.file)) } : each)))
    }),
  )
}

type StageResult = { readonly state: 'ready'; readonly file: StagedFile } | { readonly state: 'failed'; readonly failure: AttachmentFailure }

async function stage(registry: Registry, attachment: Attachment, file: FileLike): Promise<StageResult> {
  const chunk = { id: attachment.id, name: attachment.name, mimetype: attachment.mimetype }
  let offset = 0
  const failed = (reason: AttachmentFailure): StageResult => {
    void window.juno.app.reportStagingFailure({ id: attachment.id, reason, offset }).catch(() => {})
    return { state: 'failed', failure: reason }
  }
  const refused = (exit: Awaited<ReturnType<typeof runCommand<typeof filesStage>>>): StageResult => {
    const error = errorOf(exit)
    if (error?._tag === 'NotSignedIn') return failed('not_signed_in')
    if (error?._tag === 'RpcClientError') return failed('connection_error')
    if (error?._tag === 'Rejected' && (error.code === 'bad_chunk' || error.code === 'file_too_large')) return failed(error.code)
    return failed('engine_error')
  }
  try {
    // The engine knows the file before any bytes are read, so a send can name it at once (spec section 8).
    const named = runCommand(registry, filesStage, { ...chunk, offset: 0, size: file.size, bytes: new Uint8Array(0), last: false })
    firstChunks.set(attachment.id, named)
    const first = await named
    if (first._tag === 'Failure') return refused(first)
    for (; offset < file.size || offset === 0; offset += STAGE_CHUNK_BYTES) {
      const end = Math.min(file.size, offset + STAGE_CHUNK_BYTES)
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer())
      } catch {
        return failed('read_error')
      }
      const exit = await runCommand(registry, filesStage, { ...chunk, offset, bytes, last: end >= file.size })
      if (exit._tag === 'Failure') return refused(exit)
      if (exit.value !== null) return { state: 'ready', file: exit.value }
    }
  } catch {
    return failed('engine_error')
  }
  return failed('engine_error')
}

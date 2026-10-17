/**
 * Staging attached files (architecture 9): each file's bytes go to the
 * engine in chunks of at most `STAGE_CHUNK_BYTES` (`files.stage`). Apart
 * from `attachments.ts` so the renderer can load it when a file is first
 * attached, not with the first bundle.
 */
import { filesStage, filesUnstage, MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE, STAGE_CHUNK_BYTES, type StagedFile } from '@juno/contract'
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
      update(registry, key, (current) => current.map((each) => (each.id === attachment.id ? { ...each, ...(staged === undefined ? { state: 'failed' as const } : fromStaged(staged)) } : each)))
    }),
  )
}

async function stage(registry: Registry, attachment: Attachment, file: FileLike): Promise<StagedFile | undefined> {
  const chunk = { id: attachment.id, name: attachment.name, mimetype: attachment.mimetype }
  try {
    // The engine knows the file before any bytes are read, so a send can name it at once (spec section 8).
    const named = runCommand(registry, filesStage, { ...chunk, offset: 0, size: file.size, bytes: new Uint8Array(0), last: false })
    firstChunks.set(attachment.id, named)
    if ((await named)._tag === 'Failure') return undefined
    for (let offset = 0; offset < file.size || offset === 0; offset += STAGE_CHUNK_BYTES) {
      const end = Math.min(file.size, offset + STAGE_CHUNK_BYTES)
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer())
      const exit = await runCommand(registry, filesStage, { ...chunk, offset, bytes, last: end >= file.size })
      if (exit._tag === 'Failure') return undefined
      if (exit.value !== null) return exit.value
    }
  } catch {
    // The file could not be read (moved, or not a file).
  }
  return undefined
}

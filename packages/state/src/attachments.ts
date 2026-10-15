/**
 * Attachments in the composer (spec section 8; architecture 9).
 *
 * A composer's files live in `attachmentsAtom(key)`, keyed by what owns
 * the draft: a topic's id, or a New chat tab's id. They are memory only,
 * so they survive tab switches and New chat's changes of destination but
 * not a restart. Each file is staged in the engine as soon as it is
 * attached (`files.stage`, in chunks of at most `STAGE_CHUNK_BYTES`), and
 * `messages.send` names the staged ones.
 */
import * as Atom from 'effect/reactivity/Atom'
import { filesStage, filesUnstage, MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE, STAGE_CHUNK_BYTES, uploadsProgress, type StagedFile } from '@juno/contract'
import type { JunoBridge } from '@juno/contract/channels'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

declare const window: { readonly juno: JunoBridge }

/** The part of a DOM `File` staging reads; the state package has no DOM types. */
export interface FileLike {
  readonly name: string
  readonly size: number
  readonly type: string
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

/** One file in a composer, as its chip shows it. */
export interface Attachment {
  readonly id: string
  readonly name: string
  readonly size: number
  readonly mimetype: string
  /** `staging` while the bytes go to the engine, `failed` when they could not. */
  readonly state: 'staging' | 'ready' | 'failed'
  /** An image's preview, once staged. */
  readonly preview?: string | undefined
}

/** The files of the composer whose draft `key` owns, in the order they were attached. */
export const attachmentsAtom = Atom.family((_key: string) => Atom.make<ReadonlyArray<Attachment>>([]).pipe(Atom.keepAlive))

const update = (registry: Registry, key: string, change: (files: ReadonlyArray<Attachment>) => ReadonlyArray<Attachment>) =>
  registry.set(attachmentsAtom(key), change(registry.get(attachmentsAtom(key))))

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
  update(registry, key, (current) => [...current, ...added.map((each) => each.attachment)])
  await Promise.all(
    added.map(async ({ file, attachment }) => {
      const staged = await stage(registry, attachment, file)
      const removed = !registry.get(attachmentsAtom(key)).some((each) => each.id === attachment.id)
      // The chip went while its bytes were on the way: they go too.
      if (removed && staged !== undefined) return void runCommand(registry, filesUnstage, { id: attachment.id })
      update(registry, key, (current) => current.map((each) => (each.id === attachment.id ? { ...each, ...(staged === undefined ? { state: 'failed' as const } : fromStaged(staged)) } : each)))
    }),
  )
}

async function stage(registry: Registry, attachment: Attachment, file: FileLike): Promise<StagedFile | undefined> {
  try {
    for (let offset = 0; offset < file.size || offset === 0; offset += STAGE_CHUNK_BYTES) {
      const end = Math.min(file.size, offset + STAGE_CHUNK_BYTES)
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer())
      const exit = await runCommand(registry, filesStage, { id: attachment.id, name: attachment.name, mimetype: attachment.mimetype, offset, bytes, last: end >= file.size })
      if (exit._tag === 'Failure') return undefined
      if (exit.value !== null) return exit.value
    }
  } catch {
    // The file could not be read (moved, or not a file).
  }
  return undefined
}

/** Removes a chip; its staged bytes are deleted. */
export function removeAttachment(registry: Registry, key: string, id: string): void {
  update(registry, key, (current) => current.filter((each) => each.id !== id))
  void runCommand(registry, filesUnstage, { id })
}

/** The staged files of a composer that a send takes, or undefined while one is still staging. Failed chips are left out. */
export function readyFiles(registry: Registry, key: string): ReadonlyArray<string> | undefined {
  const files = registry.get(attachmentsAtom(key))
  if (files.some((each) => each.state === 'staging')) return undefined
  return files.filter((each) => each.state === 'ready').map((each) => each.id)
}

/** Empties a composer's chips after a send; the post owns the staged files now. */
export function clearAttachments(registry: Registry, key: string): void {
  registry.set(attachmentsAtom(key), [])
}

/** Puts chips back, after a send that queued nothing. */
export function restoreAttachments(registry: Registry, key: string, files: ReadonlyArray<Attachment>): void {
  update(registry, key, (current) => [...files, ...current.filter((each) => !files.some((file) => file.id === each.id))])
}

/** How far each post being sent with files has got, by `clientMsgId`. */
export const uploadProgressAtom = liveQuery(uploadsProgress)(undefined)

/** Download: main saves the file into ~/Downloads and shows it in Finder. Resolves whether it was saved. */
export async function downloadFile(file: { readonly url: string; readonly name: string }): Promise<boolean> {
  try {
    return (await window.juno.shell.downloadFile(file)) === 'saved'
  } catch {
    return false
  }
}

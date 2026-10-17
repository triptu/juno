/**
 * Attachments in the composer (spec section 8; architecture 9).
 *
 * A composer's files live in `attachmentsAtom(key)`, keyed by what owns
 * the draft: a topic's id, or a Home tab's id. They are memory only,
 * so they survive tab switches and Home's changes of destination but
 * not a restart. Each file is staged in the engine as soon as it is
 * attached (`staging.ts`), and `messages.send` names the staged ones.
 */
import * as Atom from 'effect/reactivity/Atom'
import { filesUnstage, MAX_FILES_PER_MESSAGE, uploadsProgress } from '@juno/contract'
import type { JunoBridge } from '@juno/contract/channels'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import type { FileLike } from './staging'

declare const window: { readonly juno: JunoBridge }

/** One file in a composer, as its chip shows it. */
export interface Attachment {
  readonly id: string
  readonly name: string
  readonly size: number
  readonly mimetype: string
  /** `staging` while the bytes go to the engine, `failed` when they could not. */
  readonly state: 'staging' | 'ready' | 'failed'
  /** An image's preview, once staged; a Juno-only image's is made from its file before its chip shows (`attachLocal`). */
  readonly preview?: string | undefined
  /** Held here only, for Juno: never staged in the engine (`attachLocal`). */
  readonly local?: true
}

/**
 * Each attached file, by chip id, while its chip is in a composer: a send
 * to Juno reads it there, since Juno's files never go through the engine
 * (SPEC 12, "Writing").
 */
export const attachedFiles = new Map<string, FileLike>()

/** The files of the composer whose draft `key` owns, in the order they were attached. */
export const attachmentsAtom = Atom.family((_key: string) => Atom.make<ReadonlyArray<Attachment>>([]).pipe(Atom.keepAlive))

export const update = (registry: Registry, key: string, change: (files: ReadonlyArray<Attachment>) => ReadonlyArray<Attachment>) =>
  registry.set(attachmentsAtom(key), change(registry.get(attachmentsAtom(key))))

/** Removes a chip; its staged bytes are deleted. */
export function removeAttachment(registry: Registry, key: string, id: string): void {
  const local = registry.get(attachmentsAtom(key)).find((each) => each.id === id)?.local === true
  update(registry, key, (current) => current.filter((each) => each.id !== id))
  attachedFiles.delete(id)
  if (!local) void runCommand(registry, filesUnstage, { id })
}

/**
 * Adds files to a composer only Juno reads (the Juno tab and the panel).
 * Nothing is staged in the engine, since nothing goes to Slack from there:
 * a chip is ready at once, or `staging` when `reading` says the renderer
 * reads its file first (`settleLocal`). Empty files and files past
 * `MAX_FILES_PER_MESSAGE` are left out, as `attachFiles` does. `preview`
 * gives a chip its picture from the start. Returns the chips added.
 */
export function attachLocal(registry: Registry, key: string, files: ReadonlyArray<FileLike>, reading: (file: FileLike) => boolean, preview: (file: FileLike) => string | undefined = () => undefined): ReadonlyArray<Attachment> {
  const room = MAX_FILES_PER_MESSAGE - registry.get(attachmentsAtom(key)).length
  const added = files
    .filter((file) => file.size > 0)
    .slice(0, Math.max(0, room))
    .map((file): Attachment => {
      const url = preview(file)
      const attachment = { id: crypto.randomUUID(), name: file.name.trim() === '' ? 'Untitled' : file.name, size: file.size, mimetype: file.type || 'application/octet-stream', state: reading(file) ? ('staging' as const) : ('ready' as const), local: true as const, ...(url === undefined ? {} : { preview: url }) }
      attachedFiles.set(attachment.id, file)
      return attachment
    })
  if (added.length > 0) update(registry, key, (current) => [...current, ...added])
  return added
}

/** A Juno-only chip once the renderer has read its file: ready with an image's preview, or failed. */
export function settleLocal(registry: Registry, key: string, id: string, settled: { readonly preview?: string } | 'failed'): void {
  update(registry, key, (current) =>
    current.map((each) => (each.id !== id ? each : settled === 'failed' ? { ...each, state: 'failed' as const } : { ...each, state: 'ready' as const, ...settled })),
  )
}

/** The staged files of a composer that a send takes, or undefined while one is still staging. Failed chips are left out. */
export function readyFiles(registry: Registry, key: string): ReadonlyArray<string> | undefined {
  const files = registry.get(attachmentsAtom(key))
  if (files.some((each) => each.state === 'staging')) return undefined
  return files.filter((each) => each.state === 'ready').map((each) => each.id)
}

/**
 * The files of a composer a send takes when it does not wait for staging
 * (the topic composer, spec section 8): the staged ones and the ones still
 * staging, which the engine takes as they are. Failed chips are left out.
 */
export function sendableFiles(registry: Registry, key: string): ReadonlyArray<string> {
  return registry.get(attachmentsAtom(key)).flatMap((each) => (each.state === 'failed' ? [] : [each.id]))
}

/**
 * The files being staged now, each with its first chunk's answer: a send
 * names a file only once the engine knows it.
 */
export const firstChunks = new Map<string, Promise<unknown>>()

/** Resolves once the engine knows every file of `ids` that is staging. */
export const whenStarted = (ids: ReadonlyArray<string>): Promise<unknown> => Promise.all(ids.map((id) => firstChunks.get(id)))

/** Empties a composer's chips after a send; the post owns the staged files now. */
export function clearAttachments(registry: Registry, key: string): void {
  for (const each of registry.get(attachmentsAtom(key))) attachedFiles.delete(each.id)
  registry.set(attachmentsAtom(key), [])
}

/**
 * Puts chips back, after a send that queued nothing. A chip taken while
 * staging whose staging has ended since cannot be sent any more: it comes
 * back failed.
 */
export function restoreAttachments(registry: Registry, key: string, files: ReadonlyArray<Attachment>, bodies?: ReadonlyMap<string, FileLike>): void {
  for (const [id, body] of bodies ?? []) attachedFiles.set(id, body)
  const back = files.map((file) => (file.state === 'staging' && !firstChunks.has(file.id) ? { ...file, state: 'failed' as const } : file))
  update(registry, key, (current) => [...back, ...current.filter((each) => !files.some((file) => file.id === each.id))])
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

/** Open in the viewer: main saves the file into a temporary folder and opens it in the default app. Resolves whether it opened. */
export async function openFile(file: { readonly url: string; readonly name: string }): Promise<boolean> {
  try {
    return (await window.juno.shell.openFile(file)) === 'saved'
  } catch {
    return false
  }
}

/** Copy image in the viewer: main puts the image behind `src` on the clipboard. Resolves whether it did. */
export async function copyImage(src: string): Promise<boolean> {
  try {
    return (await window.juno.clipboard.writeImage(src)) === 'copied'
  } catch {
    return false
  }
}

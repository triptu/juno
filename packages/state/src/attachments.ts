/**
 * Attachments in the composer (spec section 8; architecture 9).
 *
 * A composer's files live in `attachmentsAtom(key)`, keyed by what owns
 * the draft: a topic's id, or a New chat tab's id. They are memory only,
 * so they survive tab switches and New chat's changes of destination but
 * not a restart. Each file is staged in the engine as soon as it is
 * attached (`staging.ts`), and `messages.send` names the staged ones.
 */
import * as Atom from 'effect/reactivity/Atom'
import { filesUnstage, uploadsProgress } from '@juno/contract'
import type { JunoBridge } from '@juno/contract/channels'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

declare const window: { readonly juno: JunoBridge }

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

export const update = (registry: Registry, key: string, change: (files: ReadonlyArray<Attachment>) => ReadonlyArray<Attachment>) =>
  registry.set(attachmentsAtom(key), change(registry.get(attachmentsAtom(key))))

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

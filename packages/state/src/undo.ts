/**
 * The undo stack and the toast (architecture 7, ADR 0010, inventory 16).
 *
 * A command returns the undo the engine computed from the state before it.
 * `runAction` runs a user's action, keeps its undo (at most 20) and shows
 * the toast; `undoLast` replays the newest undo, from ⌘Z or the toast's
 * Undo. The renderer never computes an inverse itself.
 *
 * One toast at a time: a new one replaces the old. The toast's container
 * dismisses it after its time.
 */
import { Exit } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import type { Rpc } from 'effect/rpc'
import {
  artRestore,
  channelsIgnore,
  channelsUnignore,
  notificationsSetLevel,
  readsMarkRead,
  readsMarkUnread,
  topicsRestore,
  topicsSubscribe,
  topicsUnsubscribe,
  viewsAddChannel,
  viewsRemoveChannel,
  viewsSortChannel,
  viewsRestore,
  type CommandResult,
  type UndoCommand,
} from '@juno/contract'
import { runCommand } from './atoms'
import type { Registry } from './client'

/** How many undos are kept (inventory 16). */
export const UNDO_LIMIT = 20

/** How long a toast stays (inventory 16; the tokens `--toast-life-undo` and `--toast-life-info`). */
export const TOAST_LIFE_MS = { undo: 5_000, info: 4_000 } as const

export interface ToastContent {
  readonly text: string
  /** The resolve toast's check. */
  readonly check?: boolean
}

export interface Toast extends ToastContent {
  /** New for every toast, so a replacement is a new element. */
  readonly key: number
  /** The toast offers Undo: the action that showed it can be undone. */
  readonly undoable: boolean
}

export const toastAtom = Atom.make<Toast | undefined>(undefined).pipe(Atom.keepAlive)

export const undoStackAtom = Atom.make<ReadonlyArray<UndoCommand>>([]).pipe(Atom.keepAlive)

let toastKey = 0

/** Shows a toast, replacing any toast on screen. */
export function showToast(registry: Registry, content: ToastContent, undoable = false): void {
  registry.set(toastAtom, { ...content, key: ++toastKey, undoable })
}

/** Hides the toast `key`, unless another one has replaced it. */
export function dismissToast(registry: Registry, key: number): void {
  if (registry.get(toastAtom)?.key === key) registry.set(toastAtom, undefined)
}

/**
 * Runs a user's action. When it changed something, keeps its undo and
 * shows `toast` with Undo. Resolves with whether it succeeded.
 */
export async function runAction<R extends Rpc.Any>(
  registry: Registry,
  route: R,
  payload: Rpc.PayloadConstructor<R>,
  toast: ToastContent,
): Promise<boolean> {
  const exit = await runCommand(registry, route, payload)
  if (Exit.isFailure(exit)) return false
  const undo = (exit.value as CommandResult).undo
  if (undo === undefined) return true
  registry.set(undoStackAtom, [...registry.get(undoStackAtom), undo].slice(-UNDO_LIMIT))
  showToast(registry, toast, true)
  return true
}

/** Replays the newest undo and hides the toast. Resolves with false when there was nothing to undo. */
export async function undoLast(registry: Registry): Promise<boolean> {
  const stack = registry.get(undoStackAtom)
  const undo = stack.at(-1)
  if (undo === undefined) return false
  registry.set(undoStackAtom, stack.slice(0, -1))
  const toast = registry.get(toastAtom)
  if (toast?.undoable === true) registry.set(toastAtom, undefined)
  await replay(registry, undo)
  return true
}

/** A command's payload: the command without its tag. */
function payloadOf<T extends { readonly _tag: string }>(command: T): Omit<T, '_tag'> {
  const { _tag: _, ...payload } = command
  return payload
}

function replay(registry: Registry, undo: UndoCommand): Promise<unknown> {
  switch (undo._tag) {
    case 'topics.restore':
      return runCommand(registry, topicsRestore, payloadOf(undo))
    case 'channels.ignore':
      return runCommand(registry, channelsIgnore, payloadOf(undo))
    case 'channels.unignore':
      return runCommand(registry, channelsUnignore, payloadOf(undo))
    case 'topics.subscribe':
      return runCommand(registry, topicsSubscribe, payloadOf(undo))
    case 'topics.unsubscribe':
      return runCommand(registry, topicsUnsubscribe, payloadOf(undo))
    case 'reads.markRead':
      return runCommand(registry, readsMarkRead, payloadOf(undo))
    case 'reads.markUnread':
      return runCommand(registry, readsMarkUnread, payloadOf(undo))
    case 'notifications.setLevel':
      return runCommand(registry, notificationsSetLevel, payloadOf(undo))
    case 'topics.restoreAll':
      return Promise.all(undo.restores.map((restore) => runCommand(registry, topicsRestore, restore)))
    case 'art.restore':
      return runCommand(registry, artRestore, payloadOf(undo))
    case 'views.restore':
      return runCommand(registry, viewsRestore, payloadOf(undo))
    case 'views.addChannel':
      return runCommand(registry, viewsAddChannel, payloadOf(undo))
    case 'views.removeChannel':
      return runCommand(registry, viewsRemoveChannel, payloadOf(undo))
    case 'views.sortChannel':
      return runCommand(registry, viewsSortChannel, payloadOf(undo))
  }
}

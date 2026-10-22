/**
 * The emoji used last (SPEC 7). The engine keeps them in the workspace's
 * user.db preferences; this keeps one subscription for the whole session.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { emojiRecent, emojiFrequent, emojiUse, DEFAULT_QUICK_REACTIONS } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import { registry } from './client'

const savedRecentEmojiAtom = liveQuery(emojiRecent)({})

/** Newest first. Empty until the saved list arrives. */
export const recentEmojiAtom = Atom.make((get): ReadonlyArray<string> => {
  const saved = get(savedRecentEmojiAtom)
  return AsyncResult.isSuccess(saved) ? saved.value : []
}).pipe(Atom.keepAlive)

const savedFrequentEmojiAtom = liveQuery(emojiFrequent)({})

/** The engine's final picker names. Defaults can paint before the first answer. */
export const frequentEmojiAtom = Atom.make((get): ReadonlyArray<string> => {
  const saved = get(savedFrequentEmojiAtom)
  return AsyncResult.isSuccess(saved) ? saved.value : DEFAULT_QUICK_REACTIONS.map((reaction) => reaction.name)
}).pipe(Atom.keepAlive)

/** Records a pick. The engine saves it and every picker and composer sees the new order. */
export function noteRecentEmoji(name: string): void {
  void runCommand(registry, emojiUse, { name })
}

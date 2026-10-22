import * as Atom from 'effect/reactivity/Atom'
import { emojiRecent, emojiUse } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import { registry } from './client'

const savedRecentEmojiAtom = liveQuery(emojiRecent)({})

/** Undefined until local prefs arrive, so the picker never paints a temporary list. */
export const recentEmojiAtom = Atom.make((get): ReadonlyArray<string> | undefined => {
  const saved = get(savedRecentEmojiAtom)
  return saved._tag === 'Success' ? saved.value.recent : undefined
}).pipe(Atom.keepAlive)

export const frequentEmojiAtom = Atom.make((get) => {
  const saved = get(savedRecentEmojiAtom)
  return saved._tag === 'Success' ? saved.value.frequent : undefined
}).pipe(Atom.keepAlive)

/** Only the engine updates recency; all pickers and composers share its live value. */
export function noteRecentEmoji(name: string): void {
  void runCommand(registry, emojiUse, { name })
}

/**
 * The message menu's eleven emoji (SPEC 7, "Message menu"). Loaded with the
 * menu, when idle (`messageMenu.tsx`).
 */
import type { PreparedEmojiPicker, QuickReaction } from '@juno/contract'
import { GRID_REACTIONS } from '@juno/views'
import type { GridEmoji } from './messageMenu'

/** The common emoji of SPEC 8 (`emoji-ranking.ts` in `@juno/domain`), then one more, so the grid always fills. */
const COMMON: ReadonlyArray<GridEmoji> = [
  { name: '+1', unicode: '👍' },
  { name: 'white_check_mark', unicode: '✅' },
  { name: 'eyes', unicode: '👀' },
  { name: 'pray', unicode: '🙏' },
  { name: 'tada', unicode: '🎉' },
  { name: 'heart', unicode: '❤️' },
  { name: 'joy', unicode: '😂' },
  { name: 'fire', unicode: '🔥' },
  { name: '100', unicode: '💯' },
  { name: 'raised_hands', unicode: '🙌' },
  { name: 'slightly_smiling_face', unicode: '🙂' },
]

/**
 * The quick reactions in their order (Settings › Appearance), then the
 * frequently used emoji that the catalog knows, then the common emoji,
 * without repeats, eleven at most.
 */
export function gridEmoji(quick: ReadonlyArray<QuickReaction>, frequent: ReadonlyArray<string>, data: PreparedEmojiPicker): ReadonlyArray<GridEmoji> {
  const out: GridEmoji[] = []
  const seen = new Set<string>()
  const add = (emoji: GridEmoji) => {
    if (out.length >= GRID_REACTIONS || seen.has(emoji.name)) return
    seen.add(emoji.name)
    out.push(emoji)
  }
  for (const reaction of quick) add(reaction)
  for (const name of frequent) {
    const item = data.byName.get(name.toLowerCase())
    if (item?.unicode !== undefined) add({ name: item.name, unicode: item.unicode })
    else if (item?.url !== undefined) add({ name: item.name, unicode: `:${item.name}:`, url: item.url })
  }
  for (const emoji of COMMON) add(emoji)
  return out
}

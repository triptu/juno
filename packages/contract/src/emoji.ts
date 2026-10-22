/**
 * The standard emoji by category, with Slack's short names, for the
 * emoji picker. The data lives in `@juno/richtext`; this re-export lets
 * the renderer reach it through the contract.
 */
export { prepareEmojiPicker, type PreparedEmojiPicker, type PickerItem, workspaceEmoji, emojiCatalog, type EmojiCategory } from '@juno/domain'

/** The workspace preference in user.db that holds the emoji used last, newest first (SPEC 7). */
export const RECENT_EMOJI_PREF = 'recentEmoji'

/** Frequently used holds up to 18. */
export const MAX_RECENT_EMOJI = 18

/** The names a saved recent-emoji preference holds: its non-empty strings, once each, at most 18. */
export function recentEmojiFrom(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return []
  const names = (value as ReadonlyArray<unknown>).filter((name): name is string => typeof name === 'string' && name !== '')
  return [...new Set(names)].slice(0, MAX_RECENT_EMOJI)
}

/** A one-click reaction in the message toolbar: a standard emoji (`unicode`) or a custom one (`url`). */
export interface QuickReaction {
  /** Slack's name, for example `+1`. */
  readonly name: string
  /** The glyph; for a custom emoji, `:name:`, its text alternative. */
  readonly unicode: string
  /** A custom emoji's image. */
  readonly url?: string
}

/** The workspace preference in user.db that holds the quick reactions, in order (SPEC 7, 14). */
export const QUICK_REACTIONS_PREF = 'quickReactions'

/** The toolbar holds up to seven. */
export const MAX_QUICK_REACTIONS = 7

/** 👍 ✅ 👀, until the user chooses. */
export const DEFAULT_QUICK_REACTIONS: ReadonlyArray<QuickReaction> = [
  { name: '+1', unicode: '👍' },
  { name: 'white_check_mark', unicode: '✅' },
  { name: 'eyes', unicode: '👀' },
]

/**
 * The quick reactions a saved preference holds: its well-formed entries,
 * without repeats, at most seven. A missing or unreadable value, or an empty
 * list, gives the default three.
 */
export function quickReactionsFrom(value: unknown): ReadonlyArray<QuickReaction> {
  if (!Array.isArray(value)) return DEFAULT_QUICK_REACTIONS
  const seen = new Set<string>()
  const reactions: QuickReaction[] = []
  for (const entry of value as ReadonlyArray<unknown>) {
    if (typeof entry !== 'object' || entry === null) continue
    const { name, unicode, url } = entry as Record<string, unknown>
    if (typeof name !== 'string' || name === '' || typeof unicode !== 'string' || seen.has(name)) continue
    seen.add(name)
    const image = typeof url === 'string' ? url : undefined
    reactions.push(image === undefined ? { name, unicode } : { name, unicode, url: image })
    if (reactions.length === MAX_QUICK_REACTIONS) break
  }
  return reactions.length === 0 ? DEFAULT_QUICK_REACTIONS : reactions
}

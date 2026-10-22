import type { QuickReaction } from '@juno/contract'

/** A round face in one colour, as a small SVG, like the custom reaction fixtures. */
const blob = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${fill}"/><circle cx="11" cy="13" r="2" fill="#2B1E00"/><circle cx="21" cy="13" r="2" fill="#2B1E00"/><path d="M10 20c3 4 9 4 12 0" stroke="#2B1E00" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  )}`

/** Five quick reactions, one of them a workspace's custom emoji. */
export const fiveQuickReactions: ReadonlyArray<QuickReaction> = [
  { name: 'eyes', unicode: '👀' },
  { name: '+1', unicode: '👍' },
  { name: 'tada', unicode: '🎉' },
  { name: 'ship-it', unicode: ':ship-it:', url: blob('#C86BD6') },
  { name: 'pray', unicode: '🙏' },
]

/** The most the message menu's grid holds. */
export const elevenQuickReactions: ReadonlyArray<QuickReaction> = [
  { name: '+1', unicode: '👍' },
  { name: 'white_check_mark', unicode: '✅' },
  { name: 'eyes', unicode: '👀' },
  { name: 'pray', unicode: '🙏' },
  { name: 'tada', unicode: '🎉' },
  { name: 'heart', unicode: '❤️' },
  { name: 'ship-it', unicode: ':ship-it:', url: blob('#C86BD6') },
  { name: 'joy', unicode: '😂' },
  { name: 'fire', unicode: '🔥' },
  { name: '100', unicode: '💯' },
  { name: 'rocket', unicode: '🚀' },
]

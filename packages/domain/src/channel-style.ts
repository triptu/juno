/**
 * The icon and colour a channel gets before the user picks one (spec
 * section 5: "each channel gets an icon and a colour, picked automatically
 * at first and changeable by the user"). Both come from a hash of the
 * channel id, so a channel looks the same on every launch and in every
 * list. DMs show the person's avatar instead; group DMs show initials.
 *
 * The names are the keys `@juno/ui` draws (`channelIcons` in
 * `ChannelIcon.tsx`, `hueNames` in `Avatar.tsx`), so a row model carries
 * them as they are and no layer translates. Domain cannot import ui, so
 * the lists are repeated here; a name ui does not know draws as the
 * channel's first letter.
 */
import { Schema } from 'effect'
import type { ConversationKind } from './channel'

/** Icons a channel tile can show, by the key `@juno/ui` draws. */
export const CHANNEL_ICONS = [
  'hash',
  'megaphone',
  'rocket',
  'wrench',
  'bug',
  'flask',
  'code',
  'star',
  'book',
  'coffee',
  'globe',
  'heart',
  'lightning',
  'compass',
  'shield',
  'leaf',
] as const
export const ChannelIcon = Schema.Literals(CHANNEL_ICONS)
export type ChannelIcon = typeof ChannelIcon.Type

/** The eight person hues of `@juno/ui` (`hueNames`), the ones dark enough for a tile. */
export const CHANNEL_COLORS = ['cyan', 'claret', 'midnight', 'emeraldDark', 'plum', 'rose', 'emerald', 'jordy'] as const
export const ChannelColor = Schema.Literals(CHANNEL_COLORS)
export type ChannelColor = typeof ChannelColor.Type

export interface ChannelStyle {
  readonly icon: ChannelIcon
  readonly color: ChannelColor
}

/** FNV-1a over the id. Stable across platforms; only used to spread ids over a palette. */
export function hashId(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** The automatic style for a channel. Private channels keep a lock as their icon; the colour still comes from the id. */
export function defaultChannelStyle(id: string, kind: ConversationKind = 'public'): ChannelStyle {
  const hash = hashId(id)
  const color = CHANNEL_COLORS[hash % CHANNEL_COLORS.length]!
  // Mix the bits so the icon and the colour do not move together.
  const icon = kind === 'private' ? 'shield' : CHANNEL_ICONS[(hash >>> 8) % CHANNEL_ICONS.length]!
  return { icon, color }
}

/** The hue for a person's initials when they have no photo (tokens.md 1.6). */
export function defaultPersonColor(userId: string): ChannelColor {
  return CHANNEL_COLORS[hashId(userId) % CHANNEL_COLORS.length]!
}

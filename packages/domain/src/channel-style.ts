/**
 * The icon and colour a channel gets before the user picks one (spec
 * section 5: "each channel gets an icon and a colour, picked automatically
 * at first and changeable by the user"). Both come from a hash of the
 * channel id, so a channel looks the same on every launch and in every
 * list. DMs show the person's avatar instead; group DMs show initials.
 */
import type { ConversationKind } from './channel'

/** Lucide icon names the UI knows how to draw for a channel tile. */
export const CHANNEL_ICONS = [
  'hash',
  'megaphone',
  'rocket',
  'wrench',
  'bug',
  'flask-conical',
  'chart-line',
  'bell',
  'book-open',
  'coffee',
  'globe',
  'heart',
  'zap',
  'cloud',
  'shield',
  'leaf',
] as const
export type ChannelIcon = (typeof CHANNEL_ICONS)[number]

/** The brand hues in `@juno/tokens` (`--hue-*`), minus the ones too light for a tile. */
export const CHANNEL_COLORS = ['cyan', 'claret', 'midnight', 'emerald-dark', 'plum', 'rose', 'emerald', 'jordy'] as const
export type ChannelColor = (typeof CHANNEL_COLORS)[number]

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

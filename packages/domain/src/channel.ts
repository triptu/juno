/** Conversations as Juno sees them, and the labels the UI prints for them. */
import type { ChannelId } from './ids'

export type ConversationKind = 'public' | 'private' | 'im' | 'mpim'

export interface ChannelInfo {
  readonly id: ChannelId
  readonly kind: ConversationKind
  /** Channel name without "#", or the other person's name for a DM. */
  readonly name: string
  /** Other members' full names, for group DMs. */
  readonly memberNames?: ReadonlyArray<string>
  readonly ignored?: boolean
}

export function isDm(kind: ConversationKind): boolean {
  return kind === 'im' || kind === 'mpim'
}

/** "Maya" for "Maya Chen". The whole name when it has no spaces. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** "#eng", "Maya Chen" or "Maya, Leo". The text a row, a toast or a tab uses. */
export function channelLabel(channel: ChannelInfo): string {
  switch (channel.kind) {
    case 'public':
    case 'private':
      return `#${channel.name}`
    case 'im':
      return channel.name
    case 'mpim': {
      const names = channel.memberNames ?? []
      return names.length > 0 ? names.map(firstName).join(', ') : channel.name
    }
  }
}

/** The label without a "#" prefix, for places that already show a hash icon. */
export function channelLabelBare(channel: ChannelInfo): string {
  const label = channelLabel(channel)
  return label.startsWith('#') ? label.slice(1) : label
}

export function channelKindLabel(kind: ConversationKind): string {
  switch (kind) {
    case 'public':
      return 'Public channel'
    case 'private':
      return 'Private channel'
    case 'im':
      return 'Direct message'
    case 'mpim':
      return 'Group DM'
  }
}

/** "#eng · Main" or "Maya Chen · Main", as the spec requires for Main labels. */
export function mainLabel(channel: ChannelInfo): string {
  return `${channelLabel(channel)} · Main`
}

/** The header context pill: "eng · Public channel". No "#" next to the hash icon. */
export function contextPillText(channel: ChannelInfo): string {
  return `${channelLabelBare(channel)} · ${channelKindLabel(channel.kind)}`
}

export type ContextTint = 'public' | 'private' | 'dm'

/** Which tint a context pill gets: neutral, amber or blue. */
export function contextTint(kind: ConversationKind): ContextTint {
  return kind === 'public' ? 'public' : kind === 'private' ? 'private' : 'dm'
}

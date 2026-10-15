/**
 * Conversations as Juno sees them, and the labels the UI prints for them.
 * The vocabulary (`ConversationKind`, `ContextTint`) is declared here once,
 * as schemas, and `@juno/contract` re-exports it for the wire.
 */
import { Schema } from 'effect'
import type { ChannelId } from './ids'

export const ConversationKind = Schema.Literals(['public', 'private', 'im', 'mpim'])
export type ConversationKind = typeof ConversationKind.Type

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

/** What a channel's label is made from. */
export type ChannelNaming = Pick<ChannelInfo, 'kind' | 'name' | 'memberNames'>

/** "#eng", "Maya Chen" or "Maya, Leo". The text a row, a toast or a tab uses. */
export function channelLabel(channel: ChannelNaming): string {
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
export function channelLabelBare(channel: ChannelNaming): string {
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

/** Which tint a context pill or a channel label gets: neutral, amber or blue. */
export const ContextTint = Schema.Literals(['public', 'private', 'dm'])
export type ContextTint = typeof ContextTint.Type

/** Which tint a context pill gets: neutral, amber or blue. */
export function contextTint(kind: ConversationKind): ContextTint {
  return kind === 'public' ? 'public' : kind === 'private' ? 'private' : 'dm'
}

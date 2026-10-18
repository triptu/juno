import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { ReactNode } from 'react'
import type { ContextTint, PhosphorIcon } from '@juno/ui'
import type { HuddleConnection, HuddlePlace, HuddlePlaceKind } from './model'

/** The glyph that says what kind of place it is, as the sidebar's place line draws it. */
export const placeIcons: Record<HuddlePlaceKind, PhosphorIcon> = {
  public: Hash,
  private: Lock,
  dm: User,
  group: Users,
}

export const placeTints: Record<HuddlePlaceKind, ContextTint> = {
  public: 'public',
  private: 'private',
  dm: 'dm',
  group: 'dm',
}

export const placeKindLabels: Record<HuddlePlaceKind, string> = {
  public: 'Public channel',
  private: 'Private channel',
  dm: 'Direct message',
  group: 'Group DM',
}

/** "#eng" for a channel, the names for a DM: how copy names the place. */
export function placeLabel(place: HuddlePlace): string {
  return place.kind === 'public' || place.kind === 'private' ? `#${place.name}` : place.name
}

/** "Maya is sharing", "Maya and Leo are sharing", "You're sharing", "You and Maya are sharing". */
export function sharingLine(others: ReadonlyArray<string>, you: boolean): string | undefined {
  const names = you ? ['You', ...others] : [...others]
  if (names.length === 0) return undefined
  if (names.length === 1) return you ? "You're sharing" : `${names[0]} is sharing`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are sharing`
}

export interface StatusInput {
  readonly connection: HuddleConnection
  readonly micBlocked?: boolean
  /** First names of the others who share. */
  readonly sharers?: ReadonlyArray<string>
  readonly sharing?: boolean
  /** What the user shares, for the tab: "You're sharing Entire screen". */
  readonly sharingSource?: string
  /** Nobody else is in the huddle (the tab says so; the bar just shows no avatars). */
  readonly alone?: boolean
  /** How long the huddle has run, from the container's clock: "4:05". */
  readonly duration: ReactNode
}

/**
 * The one status line the bar and the tab's header show (SPEC 20): the most
 * useful thing first. A connection problem, then a blocked microphone, then
 * who is sharing, then being alone, then how long the huddle has run.
 */
export function statusLine({ connection, micBlocked = false, sharers = [], sharing = false, sharingSource, alone = false, duration }: StatusInput): ReactNode {
  if (connection === 'joining') return 'Joining…'
  if (connection === 'reconnecting') return 'Reconnecting…'
  if (micBlocked) return 'Microphone blocked'
  if (sharing && sharers.length === 0 && sharingSource !== undefined) return `You're sharing ${sharingSource}`
  const shares = sharingLine(sharers, sharing)
  if (shares !== undefined) return shares
  if (alone) return "You're the only one here"
  return duration
}

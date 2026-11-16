import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { ReactNode } from 'react'
import type { ContextTint, PhosphorIcon } from '@juno/ui'
import type { HuddleConnection, HuddlePlace, HuddlePlaceKind, MicrophoneProblem } from './model'
import { systemWords } from '@juno/ui'

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

/** The status line and Mute's tooltip for each microphone problem (SPEC 20, "When things go wrong"). */
export const microphoneCopy: Record<MicrophoneProblem, { readonly status: string; readonly tooltip: string }> = {
  blocked: { status: 'Microphone blocked', tooltip: `Allow the microphone in ${systemWords.systemSettings}` },
  missing: { status: 'No microphone', tooltip: 'No microphone connected' },
  failed: { status: 'Microphone unavailable', tooltip: "Couldn't start the microphone" },
}

export interface StatusInput {
  readonly connection: HuddleConnection
  readonly microphone?: MicrophoneProblem | undefined
  /** First names of the others who share. */
  readonly sharers?: ReadonlyArray<string>
  readonly sharing?: boolean
  /** The name of what the user shares: "You're sharing Built-in display". */
  readonly sharingSource?: string
  /** Nobody else is in the huddle (the tab says so; the bar just shows no avatars). */
  readonly alone?: boolean
  /** How long the huddle has run, from the container's clock: "4:05". */
  readonly duration: ReactNode
}

/**
 * The one status line the bar and the tab's header show (SPEC 20): the most
 * useful thing first. A connection problem, then a microphone problem, then
 * who is sharing, then being alone, then how long the huddle has run.
 */
export function statusLine({ connection, microphone, sharers = [], sharing = false, sharingSource, alone = false, duration }: StatusInput): ReactNode {
  if (connection === 'joining') return 'Joining…'
  if (connection === 'reconnecting') return 'Reconnecting…'
  if (microphone !== undefined) return microphoneCopy[microphone].status
  if (sharing && sharingSource !== undefined) {
    const others = sharingLine(sharers, false)
    return others === undefined ? `You're sharing ${sharingSource}` : `You're sharing ${sharingSource} · ${others}`
  }
  const shares = sharingLine(sharers, sharing)
  if (shares !== undefined) return shares
  if (alone) return "You're the only one here"
  return duration
}

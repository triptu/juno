/**
 * The view models the huddle views draw. They are the views' own: this
 * package depends on `@juno/ui` and `@juno/tokens` only, so a container maps
 * the contract's huddle routes onto these.
 */
import type { HueName } from '@juno/ui'

/** Where the huddle is. `group` is a group DM. */
export type HuddlePlaceKind = 'public' | 'private' | 'dm' | 'group'

export interface HuddlePlace {
  /** The channel name without "#", or the person's or people's names for a DM. */
  readonly name: string
  readonly kind: HuddlePlaceKind
}

export interface HuddlePerson {
  readonly id: string
  readonly name: string
  readonly initials: string
  readonly hue: HueName
  readonly avatarUrl?: string
  /** This is the user. Shown as "You". */
  readonly you?: boolean
  readonly muted?: boolean
  readonly speaking?: boolean
}

/** One shared screen someone else is showing. The user's own share is never drawn as a screen. */
export interface HuddleShare {
  readonly id: string
  /** Whose screen: "Maya" reads "Maya's screen". */
  readonly ownerName: string
  /** The first frame has not arrived yet. */
  readonly loading?: boolean
}

/** What the call is doing. `joining` from the click until media connects; `reconnecting` while the connection is down. */
export type HuddleConnection = 'joining' | 'live' | 'reconnecting'

/** The controls' state, shared by the bar and the tab. */
export interface HuddleControlsState {
  readonly muted: boolean
  /** macOS does not let Juno use the microphone: Mute shows the slashed microphone and opens System Settings. */
  readonly micBlocked?: boolean
  /** The user is sharing their screen. */
  readonly sharing: boolean
  /** Share screen is offered (phase 4). Absent until then, and no space is kept for it. */
  readonly canShare?: boolean
  /** Two others share already, so the user cannot. */
  readonly shareFull?: boolean
  /** The device menu is showing. */
  readonly devicesOpen: boolean
}

export interface HuddleControlsActions {
  readonly onMute: () => void
  /** Mute while the microphone is blocked: open System Settings at Microphone. */
  readonly onOpenMicSettings?: () => void
  readonly onShare?: () => void
  readonly onDevices: (open: boolean) => void
  readonly onLeave: () => void
}

export interface HuddleDevice {
  readonly id: string
  readonly name: string
}

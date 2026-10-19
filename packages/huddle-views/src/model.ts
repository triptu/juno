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

/**
 * What the user shares. A window is previewed in their own tab, so they can
 * see it is the right one; a whole screen never is, since it would show
 * itself over and over.
 */
export interface HuddleOwnSource {
  readonly kind: 'screen' | 'window'
  /** The screen's or the window's name: "Built-in display", "Q4 roadmap — Docs". */
  readonly name: string
}

/** One shared screen someone else is showing. The user's own window is `HuddleOwnSource`. */
export interface HuddleShare {
  readonly id: string
  /** Whose screen: "Maya" reads "Maya's screen". */
  readonly ownerName: string
  /** The first frame has not arrived yet. */
  readonly loading?: boolean
}

/** What the call is doing. `joining` from the click until media connects; `reconnecting` while the connection is down. */
export type HuddleConnection = 'joining' | 'live' | 'reconnecting'

/**
 * Why the user cannot speak. `blocked`: macOS does not let Juno use the
 * microphone. `missing`: no microphone is connected. `failed`: there is one,
 * but it would not start.
 */
export type MicrophoneProblem = 'blocked' | 'missing' | 'failed'

/** The controls' state, shared by the bar and the tab. */
export interface HuddleControlsState {
  readonly muted: boolean
  /** Mute shows the slashed microphone; while `blocked` it opens System Settings, otherwise it is dimmed. */
  readonly microphone?: MicrophoneProblem
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

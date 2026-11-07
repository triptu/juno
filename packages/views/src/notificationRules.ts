/**
 * What the Notifications page, the Details dialog and the Why popover show
 * (SPEC 14). The containers map the engine's values into these, so the
 * views never read the contract's notification types.
 */

/** Notify me or Don't notify. */
export type InstructionDirection = 'notify' | 'stay'

/** One of the owner's instructions, read when Juno reads a message on Auto. */
export interface Instruction {
  readonly id: string
  readonly direction: InstructionDirection
  readonly text: string
}

/** How an instruction is quoted: "Don't notify: social plans". */
export function instructionLine(direction: InstructionDirection, text: string): string {
  return `${direction === 'notify' ? 'Notify me' : "Don't notify"}: ${text}`
}

/** An added instruction that is really a rule about one person or channel, offered as a setting. */
export interface FoundRule {
  /** "Alex Chen", "#design". */
  readonly name: string
  readonly level: 'always' | 'never'
}

/** The Always notify switches. */
export type AlwaysNotifyKey = 'dms' | 'groupDms' | 'mentions' | 'startedThreads' | 'followedThreads'
export type AlwaysNotify = Readonly<Record<AlwaysNotifyKey, boolean>>

/** What decided one message, first that applied. */
export type DecidedBy = 'snooze' | 'hours' | 'always' | 'never' | 'ignored' | 'directMention' | 'alwaysNotify' | 'aiOff' | 'closer' | 'addressedElsewhere' | 'live' | 'instruction' | 'reading' | 'timeout' | 'burst'

/** The short name of what decided, in the Details dialog. */
export const decidedByLabels: Readonly<Record<DecidedBy, string>> = {
  snooze: 'Paused notifications',
  hours: 'Notification hours',
  always: 'Your setting',
  never: 'Your setting',
  ignored: 'Your setting',
  directMention: 'Your setting',
  alwaysNotify: 'Always notify',
  aiOff: 'AI assist off',
  closer: 'The conversation',
  addressedElsewhere: 'The conversation',
  live: 'The conversation',
  burst: 'The conversation',
  instruction: 'Your instructions',
  reading: "Juno's reading",
  timeout: "Juno's reading",
}

/** One message Juno decided on today. */
export interface Decision {
  readonly id: string
  /** Epoch milliseconds. */
  readonly at: number
  readonly sender: string
  readonly senderId: string
  readonly avatarUrl?: string
  /** "#launch · Ship date", or empty for a DM, whose sender says where. */
  readonly place: string
  readonly text: string
  readonly notified: boolean
  readonly decidedBy: DecidedBy
  /** One line built from facts: "Sam asks you something." */
  readonly reason: string
}

/** A person, channel or thread on the Always or Never list. */
export type LevelTag =
  | { readonly kind: 'channel'; readonly id: string; readonly name: string; readonly channelKind: 'public' | 'private' | 'im' | 'mpim' }
  | { readonly kind: 'person'; readonly id: string; readonly name: string; readonly avatarUrl?: string }
  | { readonly kind: 'thread'; readonly id: string; readonly name: string }

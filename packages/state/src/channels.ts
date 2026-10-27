/**
 * The channel sheet (SPEC 5, "Channel sheet"): New channel… from ⌘K and
 * Edit channel… from a channel's menu open it. The sheet holds its own
 * draft; this is only whether it is open, and for what. Also Leave
 * channel…'s question while it waits; the leave itself is in
 * `membership.ts`, which only lazy chunks import.
 */
import * as Atom from 'effect/reactivity/Atom'

/** A new channel, with the name typed in ⌘K when it came from there, or an existing channel to edit with what the user may change in it. */
export type ChannelSheetState =
  | { readonly mode: 'new'; readonly name: string }
  | { readonly mode: 'edit'; readonly channelId: string; readonly name: string; readonly rename: boolean; readonly members: boolean }

export const channelSheetAtom = Atom.make<ChannelSheetState | undefined>(undefined).pipe(Atom.keepAlive)

/** A channel as the toasts name it: `label` is "#eng". */
export interface MembershipChannel {
  readonly id: string
  readonly label: string
}

/** Leave channel… on a private channel, waiting for its answer (SPEC 5): the channel, and where the menu opened. */
export interface LeaveConfirm {
  readonly channel: MembershipChannel
  readonly at: { readonly x: number; readonly y: number }
}

export const leaveConfirmAtom = Atom.make<LeaveConfirm | undefined>(undefined).pipe(Atom.keepAlive)

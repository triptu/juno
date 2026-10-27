/**
 * The channel sheet (SPEC 5, "Channel sheet"): New channel… from ⌘K and
 * Edit channel… from a channel's menu open it. The sheet holds its own
 * draft; this is only whether it is open, and for what.
 */
import * as Atom from 'effect/reactivity/Atom'

/** A new channel, with the name typed in ⌘K when it came from there, or an existing channel to edit with what the user may change in it. */
export type ChannelSheetState =
  | { readonly mode: 'new'; readonly name: string }
  | { readonly mode: 'edit'; readonly channelId: string; readonly name: string; readonly rename: boolean; readonly members: boolean }

export const channelSheetAtom = Atom.make<ChannelSheetState | undefined>(undefined).pipe(Atom.keepAlive)

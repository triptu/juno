/**
 * Joining and leaving channels from the app (SPEC 5, 7 and 10): Join channel
 * on a preview and ⌘K's Join, and Leave channel in a channel's menus. The
 * engine does the work (`@juno/state` `joinChannel`, `leaveChannel`); this
 * puts focus in the composer a join brings, and asks before a private
 * channel is left (`LeaveConfirm.tsx`).
 */
import type { ContextMenuAt, ConversationKind, LeaveMenuItem } from '@juno/contract'
import { channelMembership, flushSidebar, joinChannel, leaveChannel, leaveConfirmAtom, registry, type MembershipChannel } from '@juno/state'
import { lastMenuPoint } from './LeaveConfirm'
import { focusComposerWhenShown } from './navigation'

/** Join channel on a preview: the composer that takes Join channel's place takes focus. */
export function joinFromPreview(channel: MembershipChannel): Promise<boolean> {
  focusComposerWhenShown()
  return joinChannel(registry, channel)
}

/** The Leave channel item for a channel's menus, or none: a DM, a channel you are not in, #general, an archived one. */
export async function leaveMenuItem(channel: { readonly id: string; readonly kind: ConversationKind }): Promise<LeaveMenuItem | undefined> {
  if (channel.kind !== 'public' && channel.kind !== 'private') return undefined
  const membership = await channelMembership(registry, channel.id)
  return membership?.canLeave === true ? (channel.kind === 'private' ? 'ask' : 'now') : undefined
}

/** Leave channel: a public one at once, with Undo; a private one asks first, where the menu opened. */
export function leaveFromMenu(channel: MembershipChannel & { readonly kind: ConversationKind }, at?: ContextMenuAt): void {
  if (channel.kind === 'private') {
    registry.set(leaveConfirmAtom, { channel: { id: channel.id, label: channel.label }, at: at ?? lastMenuPoint() })
    return
  }
  // As Ignore channel: its rows leave the sidebar at once (SPEC 5, "Holding the order").
  flushSidebar(registry)
  void leaveChannel(registry, { id: channel.id, label: channel.label })
}

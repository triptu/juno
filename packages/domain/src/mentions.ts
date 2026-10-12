/** Mention detection on a rendered body. */
import { inlinesOf, type MessageBody } from '@juno/richtext'
import type { UserId, UsergroupId } from './ids'

export interface Me {
  readonly userId: UserId
  readonly usergroupIds?: ReadonlyArray<UsergroupId>
}

/** True for a direct mention, a usergroup the user belongs to, or @here/@channel/@everyone. */
export function messageMentionsMe(body: MessageBody, me: Me): boolean {
  for (const inline of inlinesOf(body)) {
    if (inline.kind === 'user' && inline.id === me.userId) return true
    if (inline.kind === 'broadcast') return true
    if (inline.kind === 'usergroup' && me.usergroupIds?.includes(inline.id as UsergroupId)) return true
  }
  return false
}

/** Only a direct @mention or a usergroup, not @here. For the "@" tag and the mention count. */
export function messageMentionsMeDirectly(body: MessageBody, me: Me): boolean {
  for (const inline of inlinesOf(body)) {
    if (inline.kind === 'user' && inline.id === me.userId) return true
    if (inline.kind === 'usergroup' && me.usergroupIds?.includes(inline.id as UsergroupId)) return true
  }
  return false
}

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

/**
 * `messageMentionsMeDirectly` on a message's raw mrkdwn text, for queries
 * that read stored text without rendering it: `<@U…>` or a user group the
 * user is in, `<!subteam^S…>`. Never @here or @channel.
 */
export function textMentionsMeDirectly(text: string, me: Me): boolean {
  if (text.includes(`<@${me.userId}>`) || text.includes(`<@${me.userId}|`)) return true
  return (me.usergroupIds ?? []).some((id) => text.includes(`<!subteam^${id}>`) || text.includes(`<!subteam^${id}|`))
}

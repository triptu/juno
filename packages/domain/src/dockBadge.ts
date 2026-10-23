/** The dock uses the notification decision, with unread DMs in All also counting unless Never or ignored kept them quiet. */
import { isDm, type ConversationKind } from './channel'
import { ChannelId, UserId } from './ids'
import { decideNotification, type DecisionContext } from './notificationDecision'
import type { LocalTime, NotificationSettings } from './notifications'

export interface BadgeTopic {
  readonly id: string
  readonly channel: string
  readonly kind: ConversationKind
  /** The unread message's sender, including in channels and group DMs. */
  readonly person: string | null
  readonly mentionsMe: boolean
  readonly mentionsMeDirectly?: boolean
  readonly sidebarVisible?: boolean
  readonly ignored?: boolean
  /** What Auto decided when the message was read, if it was. */
  readonly auto?: boolean
}

export interface BadgeContext extends DecisionContext { readonly at: LocalTime }

export function dockBadgeActive(items: ReadonlyArray<BadgeTopic>, settings: NotificationSettings, context: BadgeContext): boolean {
  return items.some((item) => {
    if (item.sidebarVisible === false && !(item.mentionsMeDirectly ?? item.mentionsMe)) return false
    const reading = item.auto === undefined ? undefined : { needsYou: item.auto ? 'ask' as const : 'fyi' as const, probabilities: { [item.auto ? 'ask' : 'fyi']: 1 } }
    const decision = decideNotification({
      topicId: item.id, channel: { id: ChannelId.make(item.channel), kind: item.kind, name: '', ignored: item.ignored === true },
      senderId: UserId.make(item.person ?? ''), mentionsMe: item.mentionsMe,
      mentionsMeDirectly: item.mentionsMeDirectly ?? item.mentionsMe, at: context.at,
    }, settings, { ...context, aiAssist: context.aiAssist && reading !== undefined }, reading)
    if ('needsReading' in decision) return false
    if (decision.outcome === 'notify') return true
    return isDm(item.kind) && decision.decidedBy !== 'never' && decision.decidedBy !== 'ignored'
  })
}

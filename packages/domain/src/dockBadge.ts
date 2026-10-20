/** The dock uses the alert decision, with unread DMs in All also counting when held for hours or AI. */
import { isDm, type ConversationKind } from './channel'
import { ChannelId, UserId } from './ids'
import { decideWithCause, type DecisionContext, type Judgement, type LocalTime, type NotificationSettings } from './notifications'

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
  readonly judgement?: Judgement
}

export interface BadgeContext extends DecisionContext { readonly at: LocalTime }

export function dockBadgeActive(items: ReadonlyArray<BadgeTopic>, settings: NotificationSettings, context: BadgeContext): boolean {
  return items.some((item) => {
    if (item.sidebarVisible === false && !(item.mentionsMeDirectly ?? item.mentionsMe)) return false
    const decision = decideWithCause({
      topicId: item.id, channel: { id: ChannelId.make(item.channel), kind: item.kind, name: '', ignored: item.ignored === true },
      senderId: UserId.make(item.person ?? ''), mentionsMe: item.mentionsMe,
      mentionsMeDirectly: item.mentionsMeDirectly ?? item.mentionsMe, at: context.at,
    }, settings, { ...context, aiAssist: context.aiAssist && item.judgement !== undefined }, item.judgement)
    if ('needsJudgement' in decision) return false
    if (decision.decision.outcome === 'now') return true
    return isDm(item.kind) && ['hours', 'aiOff', 'juno'].includes(decision.cause.kind)
  })
}

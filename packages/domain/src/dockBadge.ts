/** Dock badge policy, over the same unread topics as the sidebar. */
import { isDm, type ConversationKind } from './channel'
import { notificationIsMuted, type NotificationSettings } from './notifications'

export interface BadgeTopic {
  readonly id: string
  readonly channel: string
  readonly kind: ConversationKind
  readonly person: string | null
  readonly mentionsMe: boolean
}

/** Never mutes the badge unless Every message overrides it. Hours and AI judgements affect alerts only. */
export function dockBadgeActive(topics: ReadonlyArray<BadgeTopic>, settings: NotificationSettings, mutedChannels: ReadonlySet<string> = new Set()): boolean {
  return topics.some((topic) => (isDm(topic.kind) || topic.mentionsMe) && !mutedChannels.has(topic.channel) && !notificationIsMuted(
    settings.threads?.[topic.id], settings.channels[topic.channel],
    topic.kind === 'im' && topic.person !== null ? settings.people[topic.person] : undefined,
  ))
}

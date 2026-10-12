import { ChannelId, Ts, UserId, mainTopicId, threadTopicId, tsFromMillis, type ChannelInfo, type Topic, type TopicOverlay } from '../src/index'

export const NOW = Date.UTC(2026, 9, 12, 12, 0, 0) // 2026-10-12 12:00 UTC
export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR

export const eng: ChannelInfo = { id: ChannelId.make('C0ENG'), kind: 'public', name: 'eng' }
export const hiring: ChannelInfo = { id: ChannelId.make('C0HIRING'), kind: 'private', name: 'hiring' }
export const maya: ChannelInfo = { id: ChannelId.make('D0MAYA'), kind: 'im', name: 'Maya Chen' }
export const group: ChannelInfo = { id: ChannelId.make('G0MPIM'), kind: 'mpim', name: 'mpdm-alex--maya--leo-1', memberNames: ['Maya Chen', 'Leo Park'] }
export const alerts: ChannelInfo = { id: ChannelId.make('C0ALERTS'), kind: 'public', name: 'alerts-prod', ignored: true }

export const me = UserId.make('U0ME')
export const mayaId = UserId.make('U0MAYA')
export const leoId = UserId.make('U0LEO')

export const ts = (millis: number): Ts => tsFromMillis(millis)

export interface TopicOptions {
  readonly channel?: ChannelInfo
  readonly kind?: 'thread' | 'main'
  /** Millis ago from NOW. */
  readonly ago?: number
  readonly unread?: number
  readonly mentionsMe?: boolean
  readonly messages?: number
  readonly overlay?: TopicOverlay
  readonly firstMessageText?: string
  readonly preview?: Topic['preview']
  readonly id?: string
}

export function topic(options: TopicOptions = {}): Topic {
  const channel = options.channel ?? eng
  const kind = options.kind ?? 'thread'
  const last = ts(NOW - (options.ago ?? HOUR))
  const rootTs = ts(NOW - (options.ago ?? HOUR) - DAY)
  return {
    id: kind === 'main' ? mainTopicId(channel.id) : threadTopicId(channel.id, rootTs),
    kind,
    channel,
    activity: {
      lastActivityTs: last,
      messageCount: options.messages ?? 3,
      unreadCount: options.unread ?? 0,
      mentionsMe: options.mentionsMe ?? false,
      participants: [mayaId, leoId],
    },
    overlay: options.overlay ?? {},
    ...(options.firstMessageText !== undefined ? { firstMessageText: options.firstMessageText } : {}),
    ...(options.preview !== undefined ? { preview: options.preview } : {}),
  }
}

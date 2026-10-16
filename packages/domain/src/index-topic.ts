/**
 * The pure part of `reindexTopics`: given a topic's messages and read state,
 * the activity row the index stores. `sync` loads the inputs and writes the
 * row; nothing here touches a database.
 */
import { messageBody, messageTitle, previewText, type Lookups, type MessageContent } from '@juno/richtext'
import { compareTs, type Ts, type UserId } from './ids'
import { messageMentionsMeDirectly, type Me } from './mentions'
import type { ReadState } from './reads'
import type { TopicActivity, TopicPreview } from './topic'

export interface IndexMessage extends MessageContent {
  readonly ts: Ts
  readonly userId?: UserId
  readonly deleted?: boolean
}

export interface IndexInput {
  /** Any order; tombstones are skipped. */
  readonly messages: ReadonlyArray<IndexMessage>
  readonly reads: ReadState
  readonly me: Me
  /** Name lookups for the preview text. */
  readonly lookups: Lookups
  /** Display name of a sender, for "Sender: text". Own messages read "You". */
  readonly senderName: (id: UserId | undefined) => string
  /** Whether local history covers everything since the read pointer. Defaults to true. */
  readonly historyComplete?: boolean
}

export interface IndexedTopic {
  readonly activity: TopicActivity
  readonly preview?: TopicPreview
  readonly rootText?: string
  readonly rootTs?: Ts
}

/**
 * How many of the latest unread messages name the row's people (SPEC section
 * 5, "Row anatomy"). Their distinct senders are stored, most recent first;
 * the row shows four and counts the rest.
 */
export const PARTICIPANT_WINDOW = 15

export function indexTopic(input: IndexInput): IndexedTopic | undefined {
  const live = input.messages.filter((m) => !m.deleted).toSorted((a, b) => compareTs(a.ts, b.ts))
  const latest = live[live.length - 1]
  const first = live[0]
  if (!latest || !first) return undefined

  const { lastReadTs, markedUnread } = input.reads
  const unread = live.filter((m) => m.userId !== input.me.userId && (lastReadTs === undefined || compareTs(m.ts, lastReadTs) > 0))
  const unreadCount = Math.max(unread.length, markedUnread ? 1 : 0)
  const mentionsMe = unread.some((m) => messageMentionsMeDirectly(messageBody(m, input.lookups), input.me))

  // The people talking in what you have not read: senders of the latest unread messages, never you. A read topic has none.
  const participants: UserId[] = []
  for (let i = unread.length - 1; i >= Math.max(0, unread.length - PARTICIPANT_WINDOW); i--) {
    const id = unread[i]?.userId
    if (id !== undefined && id !== input.me.userId && !participants.includes(id)) participants.push(id)
  }

  const sender = latest.userId === input.me.userId ? 'You' : input.senderName(latest.userId)
  const preview: TopicPreview = { sender, text: previewText(messageBody(latest, input.lookups)) }

  return {
    activity: {
      lastActivityTs: latest.ts,
      messageCount: live.length,
      unreadCount,
      unreadExact: input.historyComplete ?? true,
      mentionsMe,
      participants,
    },
    preview,
    rootTs: first.ts,
    rootText: messageTitle(first),
  }
}

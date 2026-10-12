/**
 * Branded ids. Slack ids stay strings; the brands stop a channel id from
 * being passed where a user id is expected. Topic ids follow ADR 0004:
 * `t:<channel>:<thread_ts>`, `m:<channel>`, `g:<channel>:<group_id>`.
 *
 * The message timestamp `Ts` and its helpers are owned by `@juno/slack-schema`
 * and re-exported here so rules can use them without a second import.
 */
import { Ts, isTs } from '@juno/slack-schema'
import { Schema } from 'effect'

export { Ts, compareTs, maxTs, millisToTs, minTs, tsToMillis } from '@juno/slack-schema'

export const ChannelId = Schema.String.pipe(Schema.brand('ChannelId'))
export type ChannelId = typeof ChannelId.Type

export const UserId = Schema.String.pipe(Schema.brand('UserId'))
export type UserId = typeof UserId.Type

export const UsergroupId = Schema.String.pipe(Schema.brand('UsergroupId'))
export type UsergroupId = typeof UsergroupId.Type

export const TopicId = Schema.String.check(Schema.isPattern(/^(t:[^:]+:\d+\.\d{6}|m:[^:]+|g:[^:]+:[^:]+)$/)).pipe(Schema.brand('TopicId'))
export type TopicId = typeof TopicId.Type

export const TopicKind = Schema.Literals(['thread', 'main', 'group'])
export type TopicKind = typeof TopicKind.Type

export type ParsedTopicId =
  | { readonly kind: 'thread'; readonly channel: ChannelId; readonly threadTs: Ts }
  | { readonly kind: 'main'; readonly channel: ChannelId }
  | { readonly kind: 'group'; readonly channel: ChannelId; readonly groupId: string }

export function threadTopicId(channel: ChannelId, threadTs: Ts): TopicId {
  return TopicId.make(`t:${channel}:${threadTs}`)
}

export function mainTopicId(channel: ChannelId): TopicId {
  return TopicId.make(`m:${channel}`)
}

export function groupTopicId(channel: ChannelId, groupId: string): TopicId {
  return TopicId.make(`g:${channel}:${groupId}`)
}

/** Splits a topic id into its parts. Returns `undefined` for anything that is not a topic id. */
export function parseTopicId(id: string): ParsedTopicId | undefined {
  const first = id.indexOf(':')
  if (first < 0) return undefined
  const kind = id.slice(0, first)
  const rest = id.slice(first + 1)
  if (kind === 'm') return rest.length > 0 && !rest.includes(':') ? { kind: 'main', channel: ChannelId.make(rest) } : undefined
  const second = rest.indexOf(':')
  if (second <= 0) return undefined
  const channel = ChannelId.make(rest.slice(0, second))
  const tail = rest.slice(second + 1)
  if (tail.length === 0 || tail.includes(':')) return undefined
  if (kind === 't') return isTs(tail) ? { kind: 'thread', channel, threadTs: tail } : undefined
  if (kind === 'g') return { kind: 'group', channel, groupId: tail }
  return undefined
}

export function topicKindOf(id: TopicId): TopicKind {
  return id.startsWith('t:') ? 'thread' : id.startsWith('g:') ? 'group' : 'main'
}

export function channelOfTopic(id: TopicId): ChannelId {
  return parseTopicId(id)?.channel ?? ChannelId.make('')
}

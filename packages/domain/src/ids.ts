/**
 * Branded ids. Slack ids stay strings; the brands stop a channel id from
 * being passed where a user id is expected. Topic ids follow ADR 0004:
 * `t:<channel>:<thread_ts>`, `m:<channel>`, `g:<channel>:<group_id>`.
 */
import { Schema } from 'effect'

export const ChannelId = Schema.String.pipe(Schema.brand('ChannelId'))
export type ChannelId = typeof ChannelId.Type

export const UserId = Schema.String.pipe(Schema.brand('UserId'))
export type UserId = typeof UserId.Type

export const UsergroupId = Schema.String.pipe(Schema.brand('UsergroupId'))
export type UsergroupId = typeof UsergroupId.Type

/** A Slack message timestamp, "seconds.microseconds", for example "1728000000.123456". */
export const Ts = Schema.String.check(Schema.isPattern(/^\d+\.\d{6}$/)).pipe(Schema.brand('Ts'))
export type Ts = typeof Ts.Type

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
  if (kind === 't') return Schema.is(Ts)(tail) ? { kind: 'thread', channel, threadTs: Ts.make(tail) } : undefined
  if (kind === 'g') return { kind: 'group', channel, groupId: tail }
  return undefined
}

export function topicKindOf(id: TopicId): TopicKind {
  return id.startsWith('t:') ? 'thread' : id.startsWith('g:') ? 'group' : 'main'
}

export function channelOfTopic(id: TopicId): ChannelId {
  return parseTopicId(id)?.channel ?? ChannelId.make('')
}

/**
 * Orders two timestamps. Slack timestamps are not safe to compare as floats
 * (microseconds get lost), so the two parts are compared as integers.
 */
export function compareTs(a: Ts, b: Ts): number {
  const [as = '0', au = '0'] = a.split('.')
  const [bs = '0', bu = '0'] = b.split('.')
  if (as.length !== bs.length) return as.length - bs.length
  if (as !== bs) return as < bs ? -1 : 1
  if (au !== bu) return au < bu ? -1 : 1
  return 0
}

export function maxTs(a: Ts, b: Ts): Ts {
  return compareTs(a, b) >= 0 ? a : b
}

export function tsToMillis(ts: Ts): number {
  const [s = '0', u = '0'] = ts.split('.')
  return Number(s) * 1000 + Math.floor(Number(u) / 1000)
}

export function tsFromMillis(millis: number): Ts {
  const s = Math.floor(millis / 1000)
  const u = (millis - s * 1000) * 1000
  return Ts.make(`${s}.${String(u).padStart(6, '0')}`)
}

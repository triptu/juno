/**
 * `activity.feed`, the internal method behind Slack's Activity tab
 * (research `activity-feed.md`). Juno reads it with `mode=chrono_v1` and
 * `types=message_reaction`: one entry per message of the user's that someone
 * else reacted to, newest first by `feed_ts`, the time of the latest
 * reaction. The entry names the message and that latest reaction only; the
 * other reactions are on the message. `limit` is at most 50.
 *
 * Decoding is tolerant: an entry of another type keeps its `type` and has no
 * `message` or `reaction`.
 */
import { Schema as S } from 'effect'
import { FormBoolean, FormNumber, ResponseMetadata } from './common.ts'
import { Ts } from './ts.ts'

const opt = S.optionalKey

export const ActivityFeedArgs = S.Struct({
  mode: S.String,
  /** Comma-separated entry types, such as `message_reaction`. */
  types: S.String,
  limit: opt(FormNumber),
  cursor: opt(S.String),
  archive_only: opt(FormBoolean),
  unread_only: opt(FormBoolean),
  priority_only: opt(FormBoolean),
})
export type ActivityFeedArgs = typeof ActivityFeedArgs.Type

export const ActivityFeedItem = S.Struct({
  /** Seconds as a decimal string: when the latest reaction was added. */
  feed_ts: S.String,
  is_unread: opt(S.Boolean),
  is_archived: opt(S.Boolean),
  key: opt(S.String),
  version: opt(S.String),
  item: S.Struct({
    type: S.String,
    message: opt(S.Struct({ channel: S.String, ts: Ts })),
    reaction: opt(S.Struct({ name: S.String, user: S.String })),
  }),
})
export type ActivityFeedItem = typeof ActivityFeedItem.Type

export const ActivityFeedFields = {
  items: S.Array(ActivityFeedItem),
  response_metadata: opt(ResponseMetadata),
} as const

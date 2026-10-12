/**
 * Thread subscriptions: the followed-threads view and marking, following and
 * unfollowing a thread.
 *
 * Source: docs/research/slack-data-access.md section 3.
 */
import { Schema as S } from 'effect'
import { ThreadCounts } from './boot'
import { FormBit, FormBoolean, FormNumber, Ts } from './common'
import { Message, MessageFields } from './message'

const opt = S.optionalKey

export const ThreadSubscription = S.Struct({
  type: opt(S.String),
  channel: S.String,
  thread_ts: Ts,
  last_read: opt(Ts),
  date_create: opt(S.Number),
  active: opt(S.Boolean),
})
export type ThreadSubscription = typeof ThreadSubscription.Type

// subscriptions.thread.getView

export const ThreadGetViewArgs = S.Struct({
  /** Page marker: the `latest_reply` of the last thread on the previous page. */
  current_ts: opt(Ts),
  limit: opt(FormNumber),
  fetch_threads_state: opt(FormBoolean),
  priority_mode: opt(FormBoolean),
  channel_id: opt(S.String),
})
export type ThreadGetViewArgs = typeof ThreadGetViewArgs.Type

/** A root in the threads view always says where it lives and how many replies it has. */
export const ThreadViewRoot = S.Struct({
  ...MessageFields,
  channel: S.String,
  thread_ts: Ts,
  reply_count: S.Number,
})
export type ThreadViewRoot = typeof ThreadViewRoot.Type

export const ThreadView = S.Struct({
  root_msg: ThreadViewRoot,
  unread_replies: S.Array(Message),
  latest_replies: S.Array(Message),
  priority: opt(S.Boolean),
})
export type ThreadView = typeof ThreadView.Type

export const ThreadGetViewFields = {
  threads: S.Array(ThreadView),
  has_more: S.Boolean,
  total_unread_replies: S.Number,
  threads_state: opt(ThreadCounts),
} as const

// subscriptions.thread.mark

export const ThreadMarkArgs = S.Struct({
  channel: S.String,
  thread_ts: Ts,
  /** The new `last_read`. */
  ts: Ts,
  /** `1` marks read up to `ts`, `0` marks unread from `ts`. */
  read: FormBit,
})
export type ThreadMarkArgs = typeof ThreadMarkArgs.Type
export const ThreadMarkFields = {} as const

// subscriptions.thread.add / remove

export const ThreadSubscribeArgs = S.Struct({
  channel: S.String,
  thread_ts: Ts,
  last_read: opt(Ts),
})
export type ThreadSubscribeArgs = typeof ThreadSubscribeArgs.Type
export const ThreadSubscribeFields = { subscription: opt(ThreadSubscription) } as const

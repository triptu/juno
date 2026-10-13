/**
 * Thread subscriptions: the followed-threads view and marking, following and
 * unfollowing a thread.
 *
 * Source: docs/research/slack-data-access.md section 3.
 */
import { Schema as S } from 'effect'
import { ThreadCounts } from './boot.ts'
import { FormBit, FormBoolean, FormNumber } from './common.ts'
import { Ts } from './ts.ts'
import { Message, MessageFields } from './message.ts'

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

/**
 * A root in the threads view always says where it lives, how many replies it
 * has and when the last one came (the page marker). Observed live on every
 * root; `last_read` and `subscribed` were present on every root too but stay
 * optional, as the research marks them so.
 */
export const ThreadViewRoot = S.Struct({
  ...MessageFields,
  channel: S.String,
  thread_ts: Ts,
  reply_count: S.Number,
  latest_reply: Ts,
})
export type ThreadViewRoot = typeof ThreadViewRoot.Type

export const ThreadView = S.Struct({
  root_msg: ThreadViewRoot,
  /** Absent live when the thread has no unread replies. */
  unread_replies: opt(S.Array(Message)),
  latest_replies: S.Array(Message),
  priority: opt(S.Boolean),
})
export type ThreadView = typeof ThreadView.Type

export const ThreadGetViewFields = {
  threads: S.Array(ThreadView),
  has_more: S.Boolean,
  total_unread_replies: S.Number,
  threads_state: opt(ThreadCounts),
  /** Observed live, not in the research: the newest `latest_reply` on the page and a count of new threads. */
  max_ts: opt(Ts),
  new_threads_count: opt(S.Number),
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

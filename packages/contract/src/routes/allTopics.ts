/**
 * The All topics page (spec section 11, inventory 10, architecture 4.4).
 *
 * `allTopics.list` lists every topic of every conversation the user is in,
 * except ignored channels: quiet, resolved and unfollowed ones included,
 * and threads that never had a sidebar row. Rows are the sidebar's
 * `TopicListRow`, so a row reads the same data, menu and actions; `status`
 * is the row's status chip and `section` says only whether it is pinned.
 *
 * The list can hold thousands of topics, so a subscription covers a window
 * at `offset` in the sorted, filtered list, and `meta.total` says how many
 * rows the whole list has. The page scrolls a virtual list of `total` rows
 * and moves the window as it scrolls (performance 3.5).
 *
 * `allTopics.summary` feeds the chrome: the status chips' counts under the
 * kind, place and text filters, and the conversations the place select
 * offers.
 */
import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { liveListRoute, liveValueRoute } from '../live'
import { ChannelRef } from '../refs'
import { KindFilter, TopicListRow } from './topics'

/** Rows in one window of All topics. The engine caps `range.limit` here. */
export const ALL_TOPICS_WINDOW = 200

/** The status chips: All, or one status. `unsubscribed` is the Unfollowed chip, a thread set to Never. */
export const AllTopicsChip = Schema.Literals(['all', 'open', 'resolved', 'quiet', 'unsubscribed'])
export type AllTopicsChip = typeof AllTopicsChip.Type

export const AllTopicsSort = Schema.Literals(['recent', 'oldest', 'messages'])
export type AllTopicsSort = typeof AllTopicsSort.Type

/** The filters every All topics route takes, except the chip and the sort, which change only the list. */
const narrowing = {
  kind: KindFilter,
  /** One conversation, from the place select. */
  scope: Schema.optionalKey(Schema.String),
  /** Words to find in titles and messages. Each word matches the start of a word; empty or absent matches everything. */
  query: Schema.optionalKey(Schema.String),
}

export const AllTopicsFilter = Schema.Struct({ ...narrowing, status: AllTopicsChip, sort: AllTopicsSort })
export type AllTopicsFilter = typeof AllTopicsFilter.Type

/**
 * One window of the list, sorted by the filter's order. `offset` is the
 * index of the first row in the whole list; `range.anchor` is not used.
 */
export const allTopicsList = liveListRoute('allTopics.list', {
  row: TopicListRow,
  payload: { ...AllTopicsFilter.fields, offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) },
})

export const AllTopicsCounts = Schema.Struct({
  all: Schema.Int,
  open: Schema.Int,
  resolved: Schema.Int,
  quiet: Schema.Int,
  unsubscribed: Schema.Int,
})
export type AllTopicsCounts = typeof AllTopicsCounts.Type

export const AllTopicsSummary = Schema.Struct({
  /** Topics per chip after the kind, place and text filters. */
  counts: AllTopicsCounts,
  /** The conversations of the kind filter that have topics, by label. The place select lists them. */
  places: Schema.Array(ChannelRef),
})
export type AllTopicsSummary = typeof AllTopicsSummary.Type

export const allTopicsSummary = liveValueRoute('allTopics.summary', { value: AllTopicsSummary, payload: narrowing })

export const AllTopicsRoutes = RpcGroup.make(allTopicsList, allTopicsSummary)

/**
 * The sidebar's Reactions view (SPEC 5, "Reactions"): which list the
 * sidebar shows, and the view's rows.
 *
 * `sidebarPaneAtom` is the third kind of sidebar filter beside the kinds
 * and the views: while it is `reactions` the sidebar shows reaction rows,
 * which are messages, not topics, so the topic list's filter and keys stay
 * as they are. Like the filters it is not persisted.
 *
 * `reactionFeedAtom` subscribes to `reactions.feed` while something reads
 * it. Each value keeps the row objects of the one before wherever a row is
 * unchanged, so `reactionRowAtom(id)` notifies only the rows that changed.
 */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { reactionsFeed, type ReactionRow } from '@juno/contract'
import { liveQuery } from './atoms'

type SidebarPane = 'topics' | 'reactions'

/** Which list the sidebar shows: the topics (its quick filters and views), or the Reactions view. */
export const sidebarPaneAtom = Atom.make<SidebarPane>('topics').pipe(Atom.keepAlive)

/** The previous rows' objects wherever a row is unchanged, and the previous array when nothing is. */
function keepRows(previous: ReadonlyArray<ReactionRow> | undefined, next: ReadonlyArray<ReactionRow>): ReadonlyArray<ReactionRow> {
  if (previous === undefined) return next
  const known = new Map(previous.map((row) => [row.id, row]))
  let same = previous.length === next.length
  const rows = next.map((row, index) => {
    const old = known.get(row.id)
    const kept = old !== undefined && JSON.stringify(old) === JSON.stringify(row) ? old : row
    if (kept !== previous[index]) same = false
    return kept
  })
  return same ? previous : rows
}

const feedFamily = liveQuery(reactionsFeed, { reconcile: keepRows })

/** The view's rows, newest first. Reading it subscribes. */
export const reactionFeedAtom = feedFamily(undefined)

const EMPTY: ReadonlyArray<string> = []

/** The rows' ids in order, or undefined until the first value arrives. Equal orders keep their array. */
export const reactionIdsAtom = Atom.make((get): ReadonlyArray<string> | undefined => {
  const result = get(reactionFeedAtom)
  if (!AsyncResult.isSuccess(result)) return undefined
  const ids = result.value.length === 0 ? EMPTY : result.value.map((row) => row.id)
  const before = Option.getOrUndefined(get.self<ReadonlyArray<string> | undefined>())
  return before !== undefined && before.length === ids.length && before.every((id, i) => id === ids[i]) ? before : ids
})

/** One row by id; undefined once it has left the view. */
export const reactionRowAtom = Atom.family((id: string) =>
  Atom.make((get): ReactionRow | undefined => {
    const result = get(reactionFeedAtom)
    return AsyncResult.isSuccess(result) ? result.value.find((row) => row.id === id) : undefined
  }),
)

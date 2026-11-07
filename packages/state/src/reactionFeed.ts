/**
 * The sidebar's Reactions view (SPEC 5, "Reactions"): which list the
 * sidebar shows, and the view's rows.
 *
 * `sidebarPaneAtom` is the third kind of sidebar filter beside the kinds
 * and the views: while it is `reactions` the sidebar shows reaction rows,
 * which are messages, not topics, so the topic list's filter and keys stay
 * as they are. Like the filters it is not persisted.
 *
 * `reactionRowsAtom` subscribes to `reactions.feed` while something reads
 * it, and not a moment longer: the subscription owns network work (a feed
 * read and message fetches each time it opens), so it ends when the view
 * closes and reopening starts it fresh. Each value keeps the row objects
 * of the one before wherever a row is unchanged, so unchanged rows skip
 * their render.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { reactionsFeed, type ReactionRow } from '@juno/contract'
import { liveQuery } from './atoms'

type SidebarPane = 'topics' | 'reactions'

/** Which list the sidebar shows: the topics (its quick filters and views), or the Reactions view. */
export const sidebarPaneAtom = Atom.make<SidebarPane>('topics').pipe(Atom.keepAlive)

/** Keeps the previous object of each unchanged row. */
function keepRows(previous: ReadonlyArray<ReactionRow> | undefined, next: ReadonlyArray<ReactionRow>): ReadonlyArray<ReactionRow> {
  const known = new Map(previous?.map((row) => [row.id, row]))
  return next.map((row) => {
    const old = known.get(row.id)
    return old !== undefined && JSON.stringify(old) === JSON.stringify(row) ? old : row
  })
}

const feedFamily = liveQuery(reactionsFeed, { idleTTL: 0, reconcile: keepRows })

const feedAtom = feedFamily(undefined)

/** The view's rows, newest first, or undefined until the first value arrives. Reading it subscribes. */
export const reactionRowsAtom = Atom.make((get): ReadonlyArray<ReactionRow> | undefined => {
  const result = get(feedAtom)
  return AsyncResult.isSuccess(result) ? result.value : undefined
})

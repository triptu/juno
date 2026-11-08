/**
 * The sidebar's Reactions view (SPEC 5, "Reactions"): which list the
 * sidebar shows, and the view's rows.
 *
 * `sidebarPaneAtom` is the third kind of sidebar filter beside the kinds
 * and the views: while it is `reactions` the sidebar shows reaction rows,
 * which are messages, not topics, so the topic list's filter and keys stay
 * as they are. Like the filters it is not persisted.
 *
 * `reactionRowsAtom` is the rows, a store query kept like any list's: it
 * stays subscribed 30 seconds after the view closes, so a view opened again
 * shows its rows at once and they change in place; opened later, it shows the
 * rows it last had until the new subscription answers. Each value keeps the row
 * objects of the one before wherever a row is unchanged, so unchanged rows
 * skip their render.
 *
 * `reactionWatchAtom` is the view being open, and the only part that asks
 * Slack anything (a feed read and message fetches as it opens and after a
 * reconnect), so it ends the moment the view closes and reopening starts it
 * again.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { reactionsFeed, reactionsWatch, type ReactionRow } from '@juno/contract'
import { liveQuery } from './atoms'
import { signedInAtom } from './session'

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

const feedAtom = liveQuery(reactionsFeed, { reconcile: keepRows })(undefined)

/** Mounted while the view is open; its value carries nothing. */
export const reactionWatchAtom = liveQuery(reactionsWatch, { idleTTL: 0 })(undefined)

/**
 * The rows the view last had, with their workspace: shown while a rows subscription started after the 30 seconds
 * have passed has not answered yet, so the view never opens empty once it has had rows, as the sidebar's topic
 * list keeps its rows until a new filter's arrive (performance.md 5.3).
 */
let lastRows: { readonly workspace: string; readonly rows: ReadonlyArray<ReactionRow> } | undefined

/** The view's rows, newest first, or the rows it last had in this workspace until they arrive. Reading it subscribes. */
export const reactionRowsAtom = Atom.make((get): ReadonlyArray<ReactionRow> | undefined => {
  const result = get(feedAtom)
  const workspace = get(signedInAtom)?.workspaceId
  if (AsyncResult.isSuccess(result)) {
    if (workspace !== undefined) lastRows = { workspace, rows: result.value }
    return result.value
  }
  return lastRows !== undefined && lastRows.workspace === workspace ? lastRows.rows : undefined
})

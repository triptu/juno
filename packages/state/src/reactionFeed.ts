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
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { prefsGet, prefsSet, REACTIONS_PILL_PREF, reactionsFeed, type ReactionRow } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

type SidebarPane = 'topics' | 'reactions'

/** Which list the sidebar shows: the topics (its quick filters and views), or the Reactions view. */
export const sidebarPaneAtom = Atom.make<SidebarPane>('topics').pipe(Atom.keepAlive)

const savedPillPlaceAtom = liveQuery(prefsGet)({ key: REACTIONS_PILL_PREF })

/**
 * Where the Reactions pill sits in the pill row: the id of the view it comes
 * before, or undefined after the last view. A workspace preference, so a
 * dragged pill keeps its place across a relaunch as the views do. The last
 * value holds while a new one is on its way.
 */
export const reactionsPillBeforeAtom = Atom.make((get): string | undefined => {
  const saved = get(savedPillPlaceAtom)
  if (AsyncResult.isSuccess(saved)) return typeof saved.value === 'string' ? saved.value : undefined
  return Option.getOrUndefined(get.self<string | undefined>())
})

/** Saves where the Reactions pill sits; last is saved as no preference. */
export function setReactionsPillBefore(registry: Registry, before: string | undefined) {
  return runCommand(registry, prefsSet, { key: REACTIONS_PILL_PREF, value: before ?? null })
}

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

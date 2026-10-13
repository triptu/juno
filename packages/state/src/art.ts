/**
 * Topic art in the renderer (architecture 7). The recipes travel with the
 * topics: a sidebar row's `art` comes from the window's `refs.art`, a
 * header's from `TopicDetail.art`. `topicArtAtom(id)` is the one place a
 * tab or a header asks "what does this topic look like": the sidebar's row
 * when it is shown (no extra subscription), else the topic's header value.
 * `redrawTopic` runs the Redraw command.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { artRedraw } from '@juno/contract'
import { runCommand } from './atoms'
import type { Registry } from './client'
import { topicAtom } from './messages'
import { sidebarListAtom } from './sidebar'

/**
 * The recipe of a topic's art, or `undefined` for the Tide placeholder.
 * Notifies only when the recipe changes, so a row edit or a new message
 * never re-renders a tab icon.
 */
export const topicArtAtom = Atom.family((id: string) =>
  Atom.make((get): string | undefined => {
    const row = get(sidebarListAtom).rows.get(id)
    if (row !== undefined) return row.art
    const detail = get(topicAtom(id))
    return AsyncResult.isSuccess(detail) ? (detail.value?.art ?? undefined) : undefined
  }).pipe(Atom.withEquality((a, b) => a === b)),
)

/** "Redraw": a new drawing for the topic, in place of the stored one. Resolves when the engine has stored it. */
export const redrawTopic = (registry: Registry, id: string) => runCommand(registry, artRedraw, { id })

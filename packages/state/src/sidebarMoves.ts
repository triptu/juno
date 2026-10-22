/**
 * Whether a change of the sidebar's order may move on screen (SPEC 5,
 * "Holding the order"). A reorder that comes from elsewhere (a message from
 * someone else, a topic resolved in Slack) may slide; what follows the
 * user's own actions, a filter change, a tab closing and the first sync
 * shows at once. The list view decides the rest from where it is scrolled.
 */
import * as Atom from 'effect/reactivity/Atom'
import type { Registry } from './client'
import type { TopicListFilter } from './topics'

/** `animate`: rows may slide to their new places. `instant`: they take them in one frame. */
export type SidebarMoves = 'animate' | 'instant'

/** How long after the user's own action (a resolve, a send, an Undo, a sheet closing) every change shows at once. */
export const OWN_CHANGE_MS = 1_500

/** The order a list shows, by section. */
export interface ShownOrder {
  readonly ready: boolean
  readonly filter: TopicListFilter
  readonly pinned: ReadonlyArray<string>
  readonly recent: ReadonlyArray<string>
  /** Rows kept only because a tab shows them: one leaving means a tab closed or went elsewhere. */
  readonly retained?: ReadonlySet<string> | undefined
}

/** How the change from `before` to `after` shows, `ownAt` being the time of the user's last action (`Date.now()`). */
export function sidebarMoves(before: ShownOrder | undefined, after: ShownOrder, ownAt: number, now: number, building: boolean): SidebarMoves {
  if (before === undefined || !before.ready || !after.ready || before.filter !== after.filter || building || now - ownAt < OWN_CHANGE_MS) return 'instant'
  for (const id of before.retained ?? []) if (!after.pinned.includes(id) && !after.recent.includes(id)) return 'instant'
  return 'animate'
}

/**
 * When the user last acted on a topic or the list (`Date.now()`): what
 * changes soon after shows at once, while changes from elsewhere may slide.
 * Only the sidebar's sections read it.
 */
export const sidebarOwnAtom = Atom.make(Number.NEGATIVE_INFINITY).pipe(Atom.keepAlive)

/** Your own action: the sidebar change it makes shows at once. */
export function markOwnSidebarChange(registry: Registry): void {
  registry.set(sidebarOwnAtom, Date.now())
}

/** Pure presentation policy for a change of the sidebar order (SPEC 5). */
import type { TopicListFilter } from './topics'

export type SidebarMoves = 'animate' | 'instant'

export interface ShownOrder {
  readonly ready: boolean
  readonly filter: TopicListFilter
  readonly pinned: ReadonlyArray<string>
  readonly recent: ReadonlyArray<string>
  readonly retained?: ReadonlySet<string> | undefined
}

/** Command writes and explicit releases are marked at their source, independent of elapsed time. */
export function sidebarMoves(before: ShownOrder | undefined, after: ShownOrder, own: boolean, building: boolean): SidebarMoves {
  if (before === undefined || !before.ready || !after.ready || before.filter !== after.filter || building || own) return 'instant'
  for (const id of before.retained ?? []) if (!after.pinned.includes(id) && !after.recent.includes(id)) return 'instant'
  return 'animate'
}

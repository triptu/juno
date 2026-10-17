/** What a Home row says and offers, apart from how it looks (`Home`). */
import { Broom } from '@phosphor-icons/react/dist/icons/Broom'
import { ListChecks } from '@phosphor-icons/react/dist/icons/ListChecks'
import { NotePencil } from '@phosphor-icons/react/dist/icons/NotePencil'
import { Robot } from '@phosphor-icons/react/dist/icons/Robot'
import type { AutomatedPlace, HomeItem, HomeItemKind } from '@juno/contract'
import type { PhosphorIcon } from '@juno/ui'
import { placesLine } from './settled'
import { relativeTime } from './time'

/** The cards drawn with an icon tile instead of their topic's art. */
export const TILE_ICONS: Partial<Record<HomeItemKind, PhosphorIcon>> = { tidyUp: Broom, automated: Robot, automatedMoves: Robot, doneFollowUps: ListChecks, oldDrafts: NotePencil }

/** The cards whose row opens a review sheet. */
export const opensReview = (kind: HomeItemKind): boolean => kind === 'tidyUp' || kind === 'doneFollowUps' || kind === 'oldDrafts' || kind === 'automatedMoves'

/** The meta line: plain data, the same with and without AI. */
export function metaOf(item: HomeItem, now: number): string {
  if (item.kind === 'automated') return item.reason === undefined ? 'To Automated' : `To Automated · ${item.reason}`
  if (opensReview(item.kind)) return placesLine(item.topics.map((topic) => topic.place))
  const topic = item.topics[0]
  const last = item.kind === 'moved' ? `${item.newCount ?? 0} new` : item.at === undefined ? undefined : relativeTime(item.at, now)
  const first = topic?.title
  const place = topic?.place
  return [first, place, last].filter((part) => part !== undefined && part !== '').join(' · ')
}

/** A row's buttons: Mark done, Resolve all, or Automated's Keep in All and Move. */
export function rowButtons(item: HomeItem, onMarkDone: (itemId: string) => void, onResolveAll: (itemId: string) => void, onSort: (itemId: string, to: Exclude<AutomatedPlace, 'ask'>) => void) {
  return (
    item.kind === 'followUp'
      ? [{ label: 'Mark done', run: () => onMarkDone(item.id) }]
      : item.kind === 'tidyUp'
        ? [{ label: 'Resolve all', run: () => onResolveAll(item.id) }]
        : item.kind === 'automated'
          ? [
              { label: 'Keep in All', run: () => onSort(item.id, 'kept') },
              { label: 'Move', run: () => onSort(item.id, 'automated') },
            ]
          : []
  )
}

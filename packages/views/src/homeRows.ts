/** What a Home row says and offers, apart from how it looks (`Home`). */
import { BellSlash } from '@phosphor-icons/react/dist/icons/BellSlash'
import { Brain } from '@phosphor-icons/react/dist/icons/Brain'
import { Broom } from '@phosphor-icons/react/dist/icons/Broom'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import { ListChecks } from '@phosphor-icons/react/dist/icons/ListChecks'
import { NotePencil } from '@phosphor-icons/react/dist/icons/NotePencil'
import { Robot } from '@phosphor-icons/react/dist/icons/Robot'
import { chatCopy } from '@juno/agent-contract'
import type { AutomatedPlace, HomeItem, HomeItemKind } from '@juno/contract'
import type { PhosphorIcon } from '@juno/ui'
import { placesLine } from './settled'
import { relativeTime } from './time'

/** The cards drawn with an icon tile instead of their topic's art. */
export const TILE_ICONS: Partial<Record<HomeItemKind, PhosphorIcon>> = { ask: Brain, tidyUp: Broom, automated: Robot, automatedMoves: Robot, doneFollowUps: ListChecks, oldDrafts: NotePencil, unfollow: BellSlash, ignore: EyeSlash }

/** The cards whose row opens a review sheet. */
export const opensReview = (kind: HomeItemKind): boolean => kind === 'tidyUp' || kind === 'doneFollowUps' || kind === 'oldDrafts' || kind === 'unfollow' || kind === 'ignore' || kind === 'automatedMoves'

/** The meta line: plain data, the same with and without AI. */
export function metaOf(item: HomeItem, now: number): string {
  if (item.kind === 'ask') return item.ask?.connection !== undefined ? chatCopy.ask.learn.metaConnection(item.ask.connection) : chatCopy.ask.learn.meta(item.ask?.sources ?? [])
  if (item.kind === 'automated') return item.reason === undefined ? 'To Automated' : `To Automated · ${item.reason}`
  if (opensReview(item.kind)) return placesLine(item.topics.map((topic) => topic.place))
  const topic = item.topics[0]
  // A mention in an ignored channel: the title names the person and the channel, so the meta line has the thread and the time.
  if (item.kind === 'mentioned') return [topic?.title === item.channel?.label ? undefined : topic?.title, item.at === undefined ? undefined : relativeTime(item.at, now)].filter((part) => part !== undefined && part !== '').join(' · ')
  const last = item.kind === 'moved' ? `${item.newCount ?? 0} new` : item.at === undefined ? undefined : relativeTime(item.at, now)
  const first = topic?.title
  const place = topic?.place
  return [first, place, last].filter((part) => part !== undefined && part !== '').join(' · ')
}

/** What a button on a proactive ask's row does; `open` is the row itself, which opens the ask in the Juno chat. */
export type HomeAskAnswer = 'start' | 'dismiss' | 'open'

export interface RowButton {
  readonly label: string
  readonly run: () => void
  /** The row's main action, drawn raised: Automated's Move, an ask's Start. */
  readonly primary?: boolean
}

/** A row's buttons: Mark done, Resolve all, Automated's Keep in All and Move, Dismiss on Automated's record, or an ask's Not now and Start. */
export function rowButtons(item: HomeItem, onMarkDone: (itemId: string) => void, onResolveAll: (itemId: string) => void, onSort: (itemId: string, to: Exclude<AutomatedPlace, 'ask'>) => void, onDismiss?: (itemId: string) => void, onAsk?: (itemId: string, answer: HomeAskAnswer) => void): ReadonlyArray<RowButton> {
  if (item.kind === 'ask') {
    return onAsk === undefined
      ? []
      : [
          { label: chatCopy.ask.learn.notNow, run: () => onAsk(item.id, 'dismiss') },
          { label: chatCopy.ask.learn.start, run: () => onAsk(item.id, 'start'), primary: true },
        ]
  }
  return (
    item.kind === 'followUp'
      ? [{ label: 'Mark done', run: () => onMarkDone(item.id) }]
      : item.kind === 'tidyUp'
        ? [{ label: 'Resolve all', run: () => onResolveAll(item.id) }]
        : item.kind === 'automatedMoves'
          ? onDismiss === undefined ? [] : [{ label: 'Dismiss', run: () => onDismiss(item.id) }]
        : item.kind === 'automated'
          ? [
              { label: 'Keep in All', run: () => onSort(item.id, 'kept') },
              { label: 'Move', run: () => onSort(item.id, 'automated'), primary: true },
            ]
          : []
  )
}

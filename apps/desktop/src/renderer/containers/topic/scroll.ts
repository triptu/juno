import { MESSAGE_LANDING_OFFSET } from '@juno/tokens/layout'
/**
 * The DOM side of a topic's message list: where rows are, where the list
 * opens, and the position it holds while rows change (performance 3.3).
 */
import type { RefObject } from 'react'
import type { MessageView, Person } from '@juno/contract'
import type { MessageWindow, ScrollSnapshot } from '@juno/state'
import type { MessageListItem } from '@juno/views'
import { scrollingUp } from '../scrollInput'

/** Within this of the end counts as at the bottom (performance 3.3). */
export const BOTTOM_SLACK = 32
/** How far below the header band the "N new" divider lands when a topic opens at it. */
const DIVIDER_GAP = MESSAGE_LANDING_OFFSET
/** The shortest a message row can be: the 32px avatar slot and its padding. */
const MIN_ROW_HEIGHT = 40

/**
 * The divider's offset from the scroller's top on open: 80px below the
 * header band, which the list runs under (inventory 5). The band's height
 * is the scroller's `scroll-padding-top`, so the token stays the one source.
 */
export function dividerTop(scroller: HTMLElement): number {
  return (Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0) + DIVIDER_GAP
}

/**
 * Rows above the open position that the first frame draws: enough to fill
 * the window however short the rows are. The rest of the window is drawn
 * after that frame. `innerHeight` does not force a layout.
 */
export function firstRows(): number {
  return Math.ceil(window.innerHeight / MIN_ROW_HEIGHT) + 2
}

const ROW = '[data-message-row]'

const items = new WeakMap<MessageView, MessageListItem>()

/** The people who reacted to `message`, from the window's refs, or undefined when no reaction lists anyone. */
function reactorsOf(message: MessageView, people: ReadonlyMap<string, Person>): ReadonlyMap<string, Person> | undefined {
  let found: Map<string, Person> | undefined
  for (const reaction of message.reactions) {
    for (const id of reaction.users ?? []) {
      const person = people.get(id)
      if (person !== undefined) (found ??= new Map()).set(id, person)
    }
  }
  return found
}

const samePeople = (a: ReadonlyMap<string, Person> | undefined, b: ReadonlyMap<string, Person> | undefined) =>
  a === b || (a !== undefined && b !== undefined && a.size === b.size && [...a].every(([id, person]) => b.get(id) === person))

/** The window's rows with their senders and reactors. A row keeps its object while its message and people do, so `Message` stays memoized. */
export function itemsOf(window: MessageWindow): ReadonlyArray<MessageListItem> {
  return window.order.map((ts) => {
    const message = window.rows.get(ts)!
    const sender = message.senderId === undefined ? undefined : window.refs.people.get(message.senderId)
    const reactors = reactorsOf(message, window.refs.people)
    const ids = message.thread?.replierIds
    const repliers = ids === undefined || ids.length === 0 ? undefined : new Map(ids.flatMap((id) => {
      const person = window.refs.people.get(id)
      return person === undefined ? [] : [[id, person] as const]
    }))
    const held = items.get(message)
    if (held !== undefined && held.sender === sender && samePeople(held.reactors, reactors) && samePeople(held.repliers, repliers)) return held
    const item = { message, sender, ...(repliers === undefined ? {} : { repliers }), ...(reactors === undefined ? {} : { reactors }) }
    items.set(message, item)
    return item
  })
}

export const rowSelector = (ts: string) => `[data-message-row="${CSS.escape(ts)}"]`

/**
 * The first row whose top is in view, and its offset from the top of the scroller; the row over the top edge when
 * it is taller than the view. Not the row cut by the top edge: after a jump that row may still be at its size
 * estimate, and holding its top would let its real height move every row below it. Row tops only grow down the
 * list, so a binary search reads about ten of them; a hit test at the edge finds nothing in the gap between groups.
 * When no drawn row reaches the view (a scroll up before the rows above the first frame are drawn), the first drawn
 * row below it: holding that one keeps the rows drawn later from moving what is already on screen.
 */
export function rowInView(scroller: HTMLElement): { readonly element: HTMLElement; readonly anchorKey: string; readonly offset: number } | undefined {
  const box = scroller.getBoundingClientRect()
  const rows = scroller.querySelectorAll<HTMLElement>(ROW)
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (rows[middle]!.getBoundingClientRect().top < box.top) low = middle + 1
    else high = middle
  }
  const below = rows[low]
  const element = below !== undefined && below.getBoundingClientRect().top < box.bottom ? below : (rows[low - 1] ?? below)
  const anchorKey = element?.dataset['messageRow']
  if (element === undefined || anchorKey === undefined) return undefined
  return { element, anchorKey, offset: element.getBoundingClientRect().top - box.top }
}

export function snapshotOf(scroller: HTMLElement): ScrollSnapshot | undefined {
  const row = rowInView(scroller)
  return row === undefined ? undefined : { anchorKey: row.anchorKey, offset: row.offset }
}

/**
 * The position the list goes back to whenever it changes under the user:
 * rows added above or below, the window resized. `bottom` keeps the end in
 * view; `row` keeps an element at an offset from the top (the divider on
 * open, a snapshot's row on restore, the row in view during a prepend)
 * until the user scrolls. It is applied in layout effects and the resize
 * event, before paint, and only ever writes `scrollTop`.
 */
export type Pin = { readonly kind: 'bottom' } | { readonly kind: 'row'; readonly element: Element; readonly offset: number }

/** Lists whose scroll to the bottom by `hold` has not ended yet (see `takeOwnEnd`). */
const ownEnds = new WeakSet<HTMLElement>()

/**
 * Whether a `scrollend` ends the list's own scroll to the bottom, rather than only the user's: one comes after every
 * `hold` that moved the list, also while the user's own scroll goes on.
 */
export function takeOwnEnd(scroller: HTMLElement): boolean {
  return ownEnds.delete(scroller)
}

/**
 * Puts the pinned row or the bottom back, and remembers the scrollTop it set. A row that left the list ends the pin.
 * The bottom also ends when the user is scrolling up (`scrollingUp`) and the list moved up from where it was last
 * held and is away from the end: the user's scroll is already in `scrollTop` when this runs, but its `scroll` event,
 * which lets go, may come after it in the frame, as when a row grows during a wheel gesture. With no such input the
 * list moved through scroll anchoring, as when a message arrives in a full window and its first row goes, and it
 * holds. Content that shrinks leaves the list at the end, so it holds.
 */
export function hold(scroller: HTMLElement, pin: RefObject<Pin | undefined>, pinnedTop: RefObject<number>): void {
  const held = pin.current
  if (held === undefined) return
  if ((held.kind === 'row' && !held.element.isConnected) || (held.kind === 'bottom' && scroller.scrollTop < pinnedTop.current - 1 && distanceFromBottom(scroller) > 1 && scrollingUp(scroller))) {
    pin.current = undefined
    return
  }
  if (held.kind === 'bottom') {
    const top = scroller.scrollTop
    scroller.scrollTop = scroller.scrollHeight
    if (scroller.scrollTop !== top) ownEnds.add(scroller)
  } else scroller.scrollTop += held.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - held.offset
  pinnedTop.current = scroller.scrollTop
}

/**
 * The rows laid out in full rather than at their size estimate, so the
 * position set before the first paint is where they end up: a window's
 * worth around the open position, a window's worth around
 * the row held during a source jump or an older page (`heldAt`), and the last window's worth,
 * where new messages arrive and the bottom is held. A page row drawn at its
 * estimate between the top of the view and the held row would grow a frame
 * later and move what is on screen; the page's rows are new, so laying them
 * out in full moves nothing. Everywhere else the browser's scroll anchoring
 * absorbs rows growing as they come into view.
 */
export function eagerRows(order: ReadonlyArray<string>, openAt: number, heldAt: number, rows: number): ReadonlySet<string> {
  const eager = new Set<string>()
  for (let i = Math.max(0, openAt - rows); i < Math.min(order.length, openAt + rows); i++) eager.add(order[i]!)
  if (heldAt >= 0) for (let i = Math.max(0, heldAt - rows); i < Math.min(order.length, heldAt + rows); i++) eager.add(order[i]!)
  for (let i = Math.max(0, order.length - rows); i < order.length; i++) eager.add(order[i]!)
  return eager
}

/** The row the open position shows at the top: the snapshot's row, the first unread one, or the end. */
export function openIndex(list: MessageWindow, divider: number, snapshot: ScrollSnapshot | undefined): number {
  const restored = snapshot === undefined ? -1 : list.order.indexOf(snapshot.anchorKey)
  return restored >= 0 ? restored : divider > 0 ? divider : list.order.length
}

export function distanceFromBottom(scroller: HTMLElement): number {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
}

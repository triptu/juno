/**
 * UI-only state for the sidebar (architecture 7): the quick filters and
 * scope, the current selection, the minute clock the row times read, and
 * the atoms the list container and its rows subscribe to. None of it is
 * persisted; the filters reset to All on launch and the selection follows
 * the tabs once they exist (M4).
 *
 * The list the sidebar shows is `sidebarListAtom`: the window of the
 * current filter once its first snapshot has arrived, and until then the
 * window shown before. A filter change therefore replaces the rows in one
 * step when the new window lands and never shows an empty list in between
 * (performance 5.3). `startTransition` cannot do this: `useAtomValue` is a
 * `useSyncExternalStore` subscription, which React commits synchronously.
 *
 * Rows keep their objects across filters: a row in the new window with the
 * `rev` of the row shown before is the same object, and every row atom is
 * keyed by id alone (`sidebarRowAtom`), so a filter change re-renders only
 * the rows that enter, leave or differ.
 */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import type { RowChannel, TopicDetail, TopicRow } from '@juno/contract'
import { ignoredChannelsAtom } from './ignored'
import { topicAtom } from './messages'
import { tabsAtom, tabTopic, type Tabs } from './tabs'
import { engineStatusAtom } from './engine'
import { emptyWindow, samePerson, sameOrder, type ListWindow } from './list'
import { holdOrder } from './holdOrder'
import { keepPainted } from './paintedOrder'
import { traceHold, traceList } from './sidebarTrace'
import type { Registry } from './client'
import { defaultTopicListFilter, topicCountsAtom, topicListAtom, type TopicListFilter } from './topics'

/** The quick filters (All, Channels, DMs, Unread) and the scope chip. */
export const sidebarFilterAtom = Atom.make<TopicListFilter>(defaultTopicListFilter).pipe(Atom.keepAlive)

/** The row the user picked last. Opening it is M4; until then it only marks the row. */
export const selectedTopicAtom = Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive)

/** Whether one row is the selection. Only the rows whose answer changes are notified. */
export const topicSelectedAtom = Atom.family((id: string) => Atom.make((get) => get(selectedTopicAtom) === id))

const MINUTE_MS = 60_000

/**
 * Wall-clock milliseconds, refreshed on each minute boundary while
 * something reads it. Relative times change by the minute, so a label is
 * never late. Read it through a selector that returns the label
 * (`useAtomValue(nowAtom, (now) => relativeTime(at, now))`), so a tick
 * re-renders only the rows whose label changed (performance 5.1).
 */
export const nowAtom = Atom.make<number>((get) => {
  const now = Date.now()
  let interval: ReturnType<typeof setInterval> | undefined
  const timeout = setTimeout(() => {
    get.setSelf(Date.now())
    interval = setInterval(() => get.setSelf(Date.now()), MINUTE_MS)
  }, MINUTE_MS - (now % MINUTE_MS))
  get.addFinalizer(() => {
    clearTimeout(timeout)
    if (interval !== undefined) clearInterval(interval)
  })
  return now
})

/** The window the sidebar shows, and the filter it belongs to. */
export interface SidebarWindow extends ListWindow<TopicRow> {
  /** The filter of these rows. It lags `sidebarFilterAtom` until the new filter's first snapshot arrives. */
  readonly filter: TopicListFilter
  /** Rows held for open tabs, including those that become unread again. */
  readonly retained?: ReadonlySet<string>
  /** Painted during the first sync, which is still running: rows take their places by recency as they land. */
  readonly building?: boolean
  /** Shown in a held order (`sidebarListAtom`). */
  readonly held?: boolean
  /** Kept out of recency order while a sync cycle ran (`keepPainted`): it takes the true order once the cycle ends. */
  readonly kept?: boolean
  /**
   * The true order a kept list took when its cycle ended. Every row it moves
   * was held for a change from elsewhere, so it slides even when the last
   * write, kept in `meta.own`, was the user's (`sidebarSections.ts`).
   */
  readonly settled?: boolean
}

/**
 * The new window, with the objects of the window shown before wherever a
 * row's `rev` is unchanged, and the old order array when the order is.
 * All topics carries its windows over the same way.
 */
export function carryOver(shown: ListWindow<TopicRow> | undefined, next: ListWindow<TopicRow>): ListWindow<TopicRow> {
  if (shown === undefined) return next
  const rows = new Map<string, TopicRow>()
  for (const [id, row] of next.rows) {
    const old = shown.rows.get(id)
    rows.set(id, old !== undefined && sameRow(old, row) ? old : row)
  }
  return { order: sameOrder(shown.order, next.order) ? shown.order : next.order, rows, refs: next.refs, meta: next.meta }
}

/**
 * The same row as far as a view can tell: the same `rev`, and the same
 * channel, people and art. A person's new photo or a new drawing leaves the
 * `rev` alone (both travel in `refs`), so the joined parts are compared too.
 */
function sameRow(a: TopicRow, b: TopicRow): boolean {
  if (a === b) return true
  if (a.rev !== b.rev || a.art !== b.art || a.participants.length !== b.participants.length) return false
  if (!sameChannel(a.channel, b.channel)) return false
  return a.participants.every((person, i) => samePerson(person, b.participants[i]!))
}

function sameChannel(a: RowChannel, b: RowChannel): boolean {
  if (a === b) return true
  const partners = a.partner === undefined || b.partner === undefined ? a.partner === b.partner : samePerson(a.partner, b.partner)
  const members = (a.members ?? []).length === (b.members ?? []).length && (a.members ?? []).every((person, i) => samePerson(person, b.members![i]!))
  return partners && members && a.id === b.id && a.kind === b.kind && a.name === b.name && a.label === b.label && a.tint === b.tint && a.icon === b.icon && a.color === b.color
}

/** Keep previously visible read-dependent rows while a tab still shows them. */
export function retainOpenTopics(
  shown: SidebarWindow,
  next: SidebarWindow,
  tabs: Tabs,
  details: ReadonlyMap<string, TopicDetail | null>,
): SidebarWindow {
  const open = new Set(tabs.tabs.map(tabTopic))
  let retainedRows: Map<string, TopicRow> | undefined
  const retained = new Set<string>()
  for (const id of shown.order) {
    if (!open.has(id)) continue
    if (next.rows.has(id)) {
      if (shown.retained?.has(id)) retained.add(id)
      continue
    }
    const old = shown.rows.get(id)!
    if (!shown.filter.unreadOnly && !shown.retained?.has(id) && old.unreadCount === 0 && !old.mentionsMe) continue
    const detail = details.get(id)
    // Resolved, unfollowed or no longer a channel you are in: the row goes even while its tab shows it.
    if (detail === null || (detail !== undefined && (detail.notMember !== undefined || detail.resolved && !detail.pinned || old.subscribed && !detail.subscribed))) continue
    retained.add(id)
    // The filtered query no longer carries this row. Its open topic's live
    // header supplies read state, including marks from another Slack client.
    retainedRows ??= new Map(next.rows)
    retainedRows.set(id, detail === undefined || (old.unreadCount === detail.unreadCount && old.unreadExact === detail.unreadExact && old.mentionsMe === detail.mentionsMe)
      ? old
      : { ...old, unreadCount: detail.unreadCount, unreadExact: detail.unreadExact, mentionsMe: detail.mentionsMe })
  }
  if (retained.size === 0 && !shown.retained?.size) return next
  const rows = retainedRows ?? next.rows
  const kept = shown.order.filter((id) => rows.has(id))
  const known = new Set(kept)
  const order = [...kept, ...next.order.filter((id) => !known.has(id))]
  const orderUnchanged = sameOrder(shown.order, order)
  if (orderUnchanged && retained.size === (shown.retained?.size ?? 0) &&
    [...retained].every((id) => shown.retained?.has(id)) &&
    rows.size === shown.rows.size && [...rows].every(([id, row]) => shown.rows.get(id) === row) &&
    next.meta === shown.meta && next.refs === shown.refs) return shown
  return {
    ...next, rows, order: orderUnchanged ? shown.order : order,
    filter: shown.filter, retained,
  }
}

/**
 * The window the sidebar shows: the current filter's once it has a
 * snapshot, otherwise the last one shown. `meta.seq` is 0 only before the
 * first snapshot ever. Reading it subscribes to the current filter's list.
 */
const sidebarSourceAtom = Atom.make((get): SidebarWindow => {
  const filter = get(sidebarFilterAtom)
  const result = get(topicListAtom(filter))
  const shown = Option.getOrUndefined(get.self<SidebarWindow>())
  if (!AsyncResult.isSuccess(result) || result.value.meta.seq === 0) return shown ?? { ...emptyWindow<TopicRow>(), filter }
  traceList(result.value.meta, result.value.order.length, filter)
  const status = get(engineStatusAtom)
  const syncing = status._tag !== 'Success' || status.value.syncing || status.value.phase._tag === 'booting' || status.value.phase._tag === 'catching-up'
  // An empty cache's list waits for the quick start (membership, DM names, the first followed threads); then rows fill in as they land.
  if (result.value.meta.windowCovered === false) return shown !== undefined && shown.order.length > 0 ? shown : { ...emptyWindow<TopicRow>(), meta: result.value.meta, filter }
  const next = carryOver(shown, result.value)
  // The first sync builds the list, so its rows take their places as they land and nothing re-sorts when it ends.
  // That lasts until every cycle of it has finished, the follow pass after `live` included.
  const firstSync = status._tag === 'Success' && 'first' in status.value.phase && status.value.phase.first === true
  const building = firstSync || (shown?.building === true && syncing)
  const mark = building ? { building: true } : {}
  if (shown !== undefined && shown.filter === filter) {
    // The quiet window comes with the rows it was read with, so a widening is seen with the rows it brings,
    // whichever of the list and the setting reaches the renderer first.
    const widened = next.meta.quietDays !== undefined && shown.meta.quietDays !== undefined && next.meta.quietDays > shown.meta.quietDays
    const keeping = (syncing && !building) || widened
    // Nothing new, unless a cycle kept the list out of order and has ended: then the rows settle to their true order.
    if (shown.meta === next.meta && (keeping || shown.kept !== true)) return shown
    // A cycle keeps a painted list in place, except for live activity (`keepPainted`).
    if (keeping) {
      const order = keepPainted(shown, next, status._tag === 'Success' ? status.value.startedAt : Infinity)
      return { ...next, order, filter, ...(sameOrder(order, next.order) ? {} : { kept: true }) }
    }
    // The settle moves only rows held for changes from elsewhere: it slides, whatever the last write was.
    if (shown.meta === next.meta) return { ...next, filter, ...mark, settled: true }
  }
  return { ...next, filter, ...mark }
})

/** The source window plus previously visible topics still shown by a tab. */
const sidebarLiveAtom = Atom.make((get): SidebarWindow => {
  const next = get(sidebarSourceAtom)
  const tabs = get(tabsAtom)
  const shown = Option.getOrUndefined(get.self<SidebarWindow>())
  if (shown === undefined || shown.filter !== next.filter) return next
  const details = new Map<string, TopicDetail | null>()
  const candidates = tabs.tabs.map(tabTopic).filter((id): id is string =>
    id !== undefined && shown.rows.has(id) && !next.rows.has(id),
  )
  const ignored = candidates.length > 0 ? get(ignoredChannelsAtom) : undefined
  for (const id of candidates) {
    if (ignored !== undefined && AsyncResult.isSuccess(ignored) && ignored.value.some((channel) => channel.id === shown.rows.get(id)!.channel.id)) {
      details.set(id, null)
    } else {
      const detail = get(topicAtom(id))
      if (AsyncResult.isSuccess(detail)) details.set(id, detail.value)
    }
  }
  return retainOpenTopics(shown, next, tabs, details)
})

/**
 * Whether the pointer or keyboard focus is in the topic list. The list
 * container sets it, and clears it a moment after both have left.
 */
const sidebarEngagedAtom = Atom.make(false).pipe(Atom.keepAlive)

/**
 * An explicit action (opening a topic from elsewhere, Undo, ignoring a
 * channel) showed the live order while the list was engaged. The hold
 * starts again from there on the next pointer move or focus in the list.
 */
const sidebarPausedAtom = Atom.make(false).pipe(Atom.keepAlive)

/** Topics the user acted on while the list is engaged (a send, resolve, rename, follow): they take their live place at once. */
const sidebarReleasedAtom = Atom.make<ReadonlyArray<string>>([]).pipe(Atom.keepAlive)

/**
 * How many sheets are open over the window. While one is, the list holds as
 * it does under the pointer, so nothing moves behind the sheet; what waited
 * applies when the last one closes.
 */
const sidebarSheetsAtom = Atom.make(0).pipe(Atom.keepAlive)

/** Tests only: records a change of the hold's inputs (`sidebarTrace.ts`); nothing while the harness has not asked. */
export const traceSidebarHold = (registry: Registry, what: string | (() => string)): void =>
  traceHold(what, () => ({ engaged: registry.get(sidebarEngagedAtom), paused: registry.get(sidebarPausedAtom), sheets: registry.get(sidebarSheetsAtom), released: registry.get(sidebarReleasedAtom).length }))

/** Whether the list holds its order now (SPEC 5, "Holding the order"). */
const sidebarHoldAtom = Atom.make((get) => (get(sidebarEngagedAtom) || get(sidebarSheetsAtom) > 0) && !get(sidebarPausedAtom))

/** The pointer or keyboard focus came into the list, or both have left it. Leaving shows the held changes in one step. */
export function setSidebarEngaged(registry: Registry, engaged: boolean): void {
  if (registry.get(sidebarEngagedAtom) === engaged) return
  registry.set(sidebarEngagedAtom, engaged)
  if (!engaged) {
    registry.set(sidebarPausedAtom, false)
    if (registry.get(sidebarReleasedAtom).length > 0) registry.set(sidebarReleasedAtom, [])
  }
  traceSidebarHold(registry, engaged ? 'engaged' : 'left')
}

/** A sheet opened over the window: the list holds from the order shown, paused or not. */
export function openSidebarSheet(registry: Registry): void {
  const open = registry.get(sidebarSheetsAtom)
  if (open === 0 && registry.get(sidebarPausedAtom)) registry.set(sidebarPausedAtom, false)
  registry.set(sidebarSheetsAtom, open + 1)
  traceSidebarHold(registry, 'sheet opened')
}

export const sidebarInstantAtom = Atom.make(0).pipe(Atom.keepAlive)

/**
 * A sheet closed. When it was the last, what waited applies in one step,
 * the moves made in the sheet with the rest. Under the pointer the list
 * then shows the live order until it is touched again, as after an
 * explicit action.
 */
export function closeSidebarSheet(registry: Registry): void {
  Atom.batch(() => {
    if (registry.get(sidebarSheetsAtom) === 0) return
    registry.set(sidebarInstantAtom, registry.get(sidebarInstantAtom) + 1)
    const open = Math.max(0, registry.get(sidebarSheetsAtom) - 1)
    registry.set(sidebarSheetsAtom, open)
    if (open === 0) {
      if (registry.get(sidebarEngagedAtom)) registry.set(sidebarPausedAtom, true)
      else if (registry.get(sidebarReleasedAtom).length > 0) registry.set(sidebarReleasedAtom, [])
    }
    traceSidebarHold(registry, 'sheet closed')
  })
}

/** The pointer moved, or focus moved, in the list: a paused hold starts again from the order shown. */
export function resumeSidebarHold(registry: Registry): void {
  if (!registry.get(sidebarPausedAtom)) return
  registry.set(sidebarPausedAtom, false)
  traceSidebarHold(registry, 'resumed')
}

/** The user acted on this topic: its move, arrival or departure shows at once, even while the list holds, except behind a sheet. */
export function releaseSidebarTopic(registry: Registry, id: string): void {
  Atom.batch(() => {
    if (!registry.get(sidebarEngagedAtom) || registry.get(sidebarSheetsAtom) > 0) return
    const released = registry.get(sidebarReleasedAtom)
    if (released.includes(id)) return
    registry.set(sidebarInstantAtom, registry.get(sidebarInstantAtom) + 1)
    registry.set(sidebarReleasedAtom, [...released, id])
    traceSidebarHold(registry, 'released a topic')
  })
}

/** An explicit action elsewhere: show the live order now, and keep showing it until the list is touched again. Behind a sheet it waits for the sheet to close. */
export function flushSidebar(registry: Registry): void {
  Atom.batch(() => {
    if (!registry.get(sidebarEngagedAtom) || registry.get(sidebarSheetsAtom) > 0) return
    registry.set(sidebarInstantAtom, registry.get(sidebarInstantAtom) + 1)
    registry.set(sidebarPausedAtom, true)
    traceSidebarHold(registry, 'flushed')
  })
}

/**
 * The window the sidebar shows: the live one, or while the list holds, the
 * held order with live contents (`holdOrder`). A hold starts from the live
 * window of that moment. A filter change, a pause and the end of the hold
 * show the live window. An empty or unready list never holds.
 */
export const sidebarListAtom = Atom.make((get): SidebarWindow => {
  const live = get(sidebarLiveAtom)
  if (!get(sidebarHoldAtom)) return live
  const shown = Option.getOrUndefined(get.self<SidebarWindow>())
  if (shown === undefined || shown.held !== true || shown.filter !== live.filter || shown.order.length === 0) return { ...live, held: true }
  return { ...holdOrder(shown, live, new Set(get(sidebarReleasedAtom))), held: true }
})

/** One row of the sidebar, by id across every filter. Notifies only when the row's object changes, which is when its `rev` does. */
export const sidebarRowAtom = Atom.family((id: string) =>
  Atom.make((get): TopicRow | undefined => get(sidebarListAtom).rows.get(id)).pipe(Atom.withEquality((a, b) => a === b)),
)


/**
 * The row that had focus last, by keyboard or pointer. Tab returns to it, so
 * after arrowing to a row, Tab reaches that row's Resolve button.
 */
export const focusedTopicAtom = Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive)

/**
 * The row that takes Tab focus (roving tabindex): the row focused last while
 * it is shown, else the selection while it is shown, else the first row.
 */
const currentTopicAtom = Atom.make((get): string | undefined => {
  const window = get(sidebarListAtom)
  const focused = get(focusedTopicAtom)
  if (focused !== undefined && window.rows.has(focused)) return focused
  const selected = get(selectedTopicAtom)
  return selected !== undefined && window.rows.has(selected) ? selected : window.order[0]
})

/** Whether one row is the tabbable one. Only the rows whose answer changes are notified. */
export const currentRowAtom = Atom.family((id: string) => Atom.make((get) => get(currentTopicAtom) === id))

export type SidebarGroup = 'channels' | 'dms'

/**
 * Whether a filter group has unread topics the sidebar would show, within
 * the current scope: the dot after "Channels" or "DMs". A boolean, so the
 * container re-renders only when a dot appears or goes.
 */
export const sidebarDotAtom = Atom.family((group: SidebarGroup) =>
  Atom.make((get): boolean => {
    const counts = get(topicCountsAtom(get(sidebarFilterAtom).scope))
    // A new scope's counts are not in yet: keep the dot as it was.
    if (!AsyncResult.isSuccess(counts)) return Option.getOrElse(get.self<boolean>(), () => false)
    return (group === 'channels' ? counts.value.channelsUnread : counts.value.dmsUnread) > 0
  }),
)

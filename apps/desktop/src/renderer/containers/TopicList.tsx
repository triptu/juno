import { memo, startTransition, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SIDEBAR_WINDOW, type KindFilter } from '@juno/contract'
import {
  quietDaysAtom,
  currentRowAtom,
  defaultTopicListFilter,
  engineStatusAtom,
  focusedTopicAtom,
  nowAtom,
  registry,
  resumeSidebarHold,
  rowRenamingAtom,
  setSidebarEngaged,
  traceSidebarHold,
  sidebarFilterAtom,
  sidebarRowAtom,
  sidebarSectionsAtom,
  topicListAtom,
  topicSelectedAtom,
  type TopicListFilter,
  viewsAtom,
} from '@juno/state'
import { afterPaint, mark, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { relativeTime, TopicList as TopicListView, TopicRow as TopicRowView, type ActivateEvent, type TopicListEmpty } from '@juno/views'
import { markFilterChange, takeFilterMark } from './filterMark'
import { openAllTopics, openTopicFromList, warmTopic } from './navigation'
import { useRowAccessory } from './rowAccessories'
import { cancelRename, renameTopic, resolveTopic, showRowMenu } from './topicActions'
import { editSelectedView } from './viewActions'

/**
 * Rows in the first commit of a new list. The rest mount in a transition
 * after that frame is painted, so the first rows paint in one short frame
 * (performance.md 3.2). Enough to fill a tall window at the shortest row
 * (a Main in Compact, 58px).
 */
const FIRST_ROWS = 32

/** An empty state seen less than this long ago shows again without its entrance (friendly-layer 5). */
const EMPTY_REPLAY_MS = 1_000

const KINDS: ReadonlyArray<KindFilter> = ['all', 'channels', 'dms']

/**
 * How long the list keeps holding its order after the pointer and keyboard
 * focus have left, so brushing past it, or crossing it on the way to the
 * title bar, does not reorder it (SPEC 5, "Holding the order").
 */
const HOLD_GRACE_MS = 400

/** Phases before the engine has caught up once: an empty list may only mean nothing has arrived yet. */
const BEFORE_LIVE = new Set(['first-run', 'booting', 'catching-up'])

/** Why the list is empty, or undefined while its first window has not arrived. */
function emptyKind(ready: boolean, filter: TopicListFilter, syncing: boolean, emptyView: boolean): TopicListEmpty | undefined {
  if (!ready) return syncing ? 'syncing' : undefined
  if (filter.unreadOnly) return 'caught-up'
  if (filter.scope === undefined && emptyView) return 'empty-view'
  if (filter.kind !== 'all' || filter.scope !== undefined) return 'filtered'
  return syncing ? 'syncing' : 'quiet'
}

// Row callbacks are created once and take the id, so no row ever receives
// a new function (performance.md 5.1).

/** Mouse down on a row (or Enter): opens the topic in the current tab, or a new one with ⌘. */
function open(id: string, event: ActivateEvent): void {
  openTopicFromList(id, { newTab: event.metaKey })
}

let releaseHold: ReturnType<typeof setTimeout> | undefined

/** The pointer or keyboard focus came into the list, or both left it: hold the order now, or let go after the grace. */
function engage(engaged: boolean, inside: { readonly pointer: boolean; readonly keyboard: boolean }): void {
  traceSidebarHold(registry, () => `list ${engaged ? 'entered' : 'left'} (pointer ${inside.pointer}, keyboard ${inside.keyboard})`)
  clearTimeout(releaseHold)
  releaseHold = undefined
  if (engaged) setSidebarEngaged(registry, true)
  else releaseHold = setTimeout(() => setSidebarEngaged(registry, false), HOLD_GRACE_MS)
}

/** The pointer or keyboard focus moved in the list: a hold paused by an action elsewhere starts again. */
function touch(): void {
  resumeSidebarHold(registry)
}

/** An unmounted list holds nothing. */
function useReleaseOnUnmount(): void {
  useEffect(
    () => () => {
      clearTimeout(releaseHold)
      setSidebarEngaged(registry, false)
    },
    [],
  )
}


/** A row got focus: Tab comes back to it, and reaches its Resolve button next. */
function focusRow(id: string): void {
  registry.set(focusedTopicAtom, id)
}

/** "View all topics" in the empty states. */
function viewAllTopics(): void {
  openAllTopics()
}

/** "Clear filters" in the empty states: back to All, everything. */
function clearFilters(): void {
  markFilterChange()
  registry.set(sidebarFilterAtom, defaultTopicListFilter)
}

/** One row. Its atoms are keyed by id alone, so it keeps its state and DOM across filter changes. */
const Row = memo(function Row({ id }: { readonly id: string }) {
  const row = useAtomValue(sidebarRowAtom(id))
  const selected = useAtomValue(topicSelectedAtom(id))
  const tabbable = useAtomValue(currentRowAtom(id))
  const renaming = useAtomValue(rowRenamingAtom(id))
  const at = row?.lastActivityAt ?? 0
  // The minute tick re-renders a row only when its label changes.
  const time = useAtomValue(nowAtom, (now) => relativeTime(at, now))
  const accessory = useRowAccessory(row)
  if (row === undefined) return null
  return (
    <TopicRowView
      row={row}
      time={time}
      selected={selected}
      tabbable={tabbable}
      newThreads={row.newThreads}
      {...(accessory === undefined ? {} : { accessory: accessory.node, accessoryLabel: accessory.label })}
      onOpen={open}
      onResolve={resolveTopic}
      onPrefetch={warmTopic}
      onContextMenu={showRowMenu}
      renaming={renaming}
      onRename={renameTopic}
      onRenameCancel={cancelRename}
    />
  )
})

const renderRow = (id: string) => <Row key={id} id={id} />

/** At most `limit` ids from Pinned then Recent, keeping the arrays when nothing is cut. */
function firstIds(pinned: ReadonlyArray<string>, recent: ReadonlyArray<string>, limit: number): readonly [ReadonlyArray<string>, ReadonlyArray<string>] {
  if (pinned.length + recent.length <= limit) return [pinned, recent]
  if (pinned.length >= limit) return [pinned.slice(0, limit), []]
  return [pinned, recent.slice(0, limit - pinned.length)]
}

/**
 * Keeps the other quick filters' lists subscribed while this one shows, so
 * switching between All, Channels and DMs is a cache hit. Starts when the
 * browser is idle after the first rows paint; each costs one engine query
 * per change to the topics.
 */
function useWarmFilters(ready: boolean, filter: TopicListFilter): void {
  const { unreadOnly, scope, kind } = filter
  useEffect(() => {
    if (!ready) return
    let release: Array<() => void> = []
    const idle = requestIdleCallback(
      () => {
        release = KINDS.filter((other) => other !== kind).map((other) => registry.mount(topicListAtom({ kind: other, unreadOnly, scope })))
      },
      { timeout: 2_000 },
    )
    return () => {
      cancelIdleCallback(idle)
      for (const off of release) off()
    }
  }, [ready, kind, unreadOnly, scope])
}

/**
 * Whether the empty state plays its entrance: yes, unless it was on screen
 * less than a second ago. Decided before the first paint, so a quick filter
 * toggle shows it still.
 */
function useEmptyEntrance(shown: boolean): boolean {
  const hiddenAt = useRef(Number.NEGATIVE_INFINITY)
  const [enter, setEnter] = useState(true)
  useLayoutEffect(() => {
    if (!shown) return
    setEnter(performance.now() - hiddenAt.current > EMPTY_REPLAY_MS)
    return () => {
      hiddenAt.current = performance.now()
    }
  }, [shown])
  return enter
}

/**
 * The sidebar list. Subscribes to the shown window's order split into
 * sections only; each row subscribes to its own atom, so a delta that
 * touches one row re-renders one row. During a filter change the old rows
 * stay until the new window arrives (`sidebarListAtom`).
 *
 * A new list (the first snapshot, or another filter) commits its first
 * rows on their own and the rest in a transition after that frame is
 * painted. Rows stay in flow, so nothing on screen moves when the rest
 * arrive below.
 */
export const TopicList = memo(function TopicList() {
  const quietDays = useAtomValue(quietDaysAtom)
  const sections = useAtomValue(sidebarSectionsAtom)
  const { filter, ready } = sections
  const painted = useRef(false)
  // The filter whose list has every row mounted.
  const [fullFor, setFullFor] = useState<TopicListFilter | undefined>(undefined)

  const count = sections.pinned.length + sections.recent.length
  const full = fullFor === filter || count <= FIRST_ROWS
  const [pinned, recent] = full ? [sections.pinned, sections.recent] : firstIds(sections.pinned, sections.recent, FIRST_ROWS)

  // Marks when the first snapshot lands, before React renders it.
  useLayoutEffect(() => {
    if (registry.get(sidebarSectionsAtom).ready) return
    let done = false
    const off = registry.subscribe(sidebarSectionsAtom, (next) => {
      if (done || !next.ready) return
      done = true
      mark('juno.sidebar-snapshot')
    })
    return off
  }, [])

  // Runs once per new window: the first rows, and each filter change.
  useEffect(() => {
    if (!sections.ready) return
    const rows = sections.pinned.length + sections.recent.length
    if (!painted.current && rows > 0) {
      painted.current = true
      afterPaint(() => {
        measure('juno.sidebar-rows', 'juno.start', { detail: { rows } })
        measure('juno.sidebar-paint', 'juno.sidebar-snapshot', { detail: { rows } })
      })
    }
    if (takeFilterMark()) afterPaint(() => measure('juno.filter', 'juno.filter', { detail: { rows } }))
  }, [sections])

  // The rest of the rows, once the first ones are on screen.
  useEffect(() => {
    if (full || !ready) return
    let cancelled = false
    afterPaint(() => {
      if (!cancelled) startTransition(() => setFullFor(filter))
    })
    return () => {
      cancelled = true
    }
  }, [full, ready, filter])

  useWarmFilters(ready, filter)

  useReleaseOnUnmount()

  const syncing = useAtomValue(engineStatusAtom, (status) => status._tag === 'Success' && BEFORE_LIVE.has(status.value.phase._tag))
  const emptyView = useAtomValue(viewsAtom, (views) => filter.view !== undefined && views.find((view) => view.id === filter.view)?.channels.length === 0)
  const empty = emptyKind(ready, filter, syncing, emptyView)
  const enterEmpty = useEmptyEntrance(ready && count === 0)

  return (
    <TopicListView
      quietDays={quietDays}
      sections={[
        { id: 'pinned', ids: pinned },
        { id: 'recent', ids: recent },
      ]}
      renderRow={renderRow}
      {...(empty === undefined ? {} : { empty })}
      enterEmpty={enterEmpty}
      truncated={full && count >= SIDEBAR_WINDOW}
      onClearFilters={clearFilters}
      onViewAll={viewAllTopics}
      onEditView={editSelectedView}
      onRowFocus={focusRow}
      onEngagedChange={engage}
      onTouch={touch}
    />
  )
})

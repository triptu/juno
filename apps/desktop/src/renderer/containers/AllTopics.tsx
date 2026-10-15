import { memo, useCallback, useDeferredValue, useEffect, useState } from 'react'
import { ALL_TOPICS_WINDOW, type AllTopicsChip, type AllTopicsFilter, type AllTopicsSort, type KindFilter } from '@juno/contract'
import {
  allTopicsFilterAtom,
  allTopicsLayoutAtom,
  allTopicsOffsetAtom,
  allTopicsRowAtom,
  allTopicsSummaryAtom,
  defaultAllTopicsFilter,
  nowAtom,
  registry,
  tableRenamingAtom,
  type AllTopicsLayout,
} from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { AllTopics as AllTopicsView, AllTopicsPlaceholderRow, AllTopicsRow, relativeTime, type ActivateEvent } from '@juno/views'
import { openTopic, takeAllTopicsOpenStart, warmTopic } from './navigation'
import { cancelRename, renameTopic, showTableRowMenu } from './topicActions'

/**
 * The window moves when the rows on screen come within this many rows of
 * its edge, and lands on a multiple of `STEP`, so scrolling back and forth
 * over a few rows reuses one subscription.
 */
const EDGE = 40
const STEP = 50

// Row callbacks are created once and take the id (performance 5.1).

function open(id: string, event: ActivateEvent): void {
  openTopic(id, { newTab: event.metaKey })
}

/** One row by id. It subscribes to its own atom, so a delta that changes one topic re-renders one row. */
const Row = memo(function Row({ id, position, tabbable }: { readonly id: string; readonly position: number; readonly tabbable: boolean }) {
  const row = useAtomValue(allTopicsRowAtom(id))
  const renaming = useAtomValue(tableRenamingAtom(id))
  const at = row?.lastActivityAt ?? 0
  const time = useAtomValue(nowAtom, (now) => relativeTime(at, now))
  if (row === undefined) return <AllTopicsPlaceholderRow position={position} />
  return (
    <AllTopicsRow
      row={row}
      time={time}
      position={position}
      tabbable={tabbable}
      onOpen={open}
      onContextMenu={showTableRowMenu}
      onPrefetch={warmTopic}
      renaming={renaming}
      onRename={renameTopic}
      onRenameCancel={cancelRename}
    />
  )
})

/** The topic id at `index` in the whole list, when the shown window holds it. */
const idAt = (layout: AllTopicsLayout, index: number): string | undefined =>
  index >= layout.offset && index < layout.offset + layout.order.length ? layout.order[index - layout.offset] : undefined

/** A new filter starts a new list at its top. */
function setFilter(next: AllTopicsFilter): void {
  registry.set(allTopicsOffsetAtom, 0)
  registry.set(allTopicsFilterAtom, next)
}

const update = (change: Partial<AllTopicsFilter>) => setFilter({ ...registry.get(allTopicsFilterAtom), ...change })

const onStatus = (status: AllTopicsChip) => update({ status })
const onSort = (sort: AllTopicsSort) => update({ sort })

function onScope(scope: string | undefined): void {
  const { scope: _scope, ...rest } = registry.get(allTopicsFilterAtom)
  setFilter(scope === undefined ? rest : { ...rest, scope })
}

/** A new kind drops a place of the other kind. */
function onKind(kind: KindFilter): void {
  const filter = registry.get(allTopicsFilterAtom)
  const place = filter.scope === undefined ? undefined : registry.get(allTopicsSummaryAtom).places.find((entry) => entry.id === filter.scope)
  const dm = place?.kind === 'im' || place?.kind === 'mpim'
  const keeps = place === undefined || kind === 'all' || (kind === 'dms') === dm
  const { scope: _scope, ...rest } = filter
  setFilter({ ...(keeps ? filter : rest), kind })
}

/**
 * Moves the window when the rows on screen near its edge: to `STEP`
 * multiples around them. The new window replaces the old one in one step
 * when it arrives; until then the rows outside the old one are placeholders.
 */
function onVisibleRange(start: number, end: number): void {
  const layout = registry.get(allTopicsLayoutAtom)
  const requested = registry.get(allTopicsOffsetAtom)
  const from = layout.offset
  const to = layout.offset + layout.order.length
  const nearTop = from > 0 && start < from + EDGE
  const nearBottom = to < layout.total && end > to - EDGE
  if (!nearTop && !nearBottom) return
  const centred = Math.floor((start + end) / 2) - ALL_TOPICS_WINDOW / 2
  const last = Math.max(0, Math.ceil((layout.total - ALL_TOPICS_WINDOW) / STEP) * STEP)
  const next = Math.min(last, Math.max(0, Math.round(centred / STEP) * STEP))
  if (next !== requested) registry.set(allTopicsOffsetAtom, next)
}

/**
 * The All topics page (spec section 11): every topic Juno knows, with the
 * status chips, the kind, place and sort selects and a text filter. The
 * table draws a virtual list of the whole list and the engine sends one
 * window of it (`allTopicsListAtom`); scrolling moves the window. Text
 * filtering is deferred, so typing is never blocked by the list.
 *
 * Loaded as its own chunk (performance 2.1).
 */
export default function AllTopicsPage() {
  const layout = useAtomValue(allTopicsLayoutAtom)
  const filter = useAtomValue(allTopicsFilterAtom)
  const summary = useAtomValue(allTopicsSummaryAtom)
  const [text, setText] = useState(filter.query ?? '')
  const query = useDeferredValue(text)

  useEffect(() => {
    if ((registry.get(allTopicsFilterAtom).query ?? '') !== query) update({ query })
  }, [query])

  // The open measure ends on the first paint with rows (performance 7.1).
  const { ready } = layout
  useEffect(() => {
    if (!ready) return
    const start = takeAllTopicsOpenStart()
    if (start !== undefined) afterPaint(() => measure('juno.all-topics-open', start, { detail: { rows: registry.get(allTopicsLayoutAtom).order.length } }))
  }, [ready])

  const rowKey = useCallback((index: number) => idAt(layout, index) ?? `slot-${index}`, [layout])
  const renderRow = useCallback(
    (index: number, tabbable: boolean) => {
      const id = idAt(layout, index)
      return id === undefined ? <AllTopicsPlaceholderRow position={index} /> : <Row id={id} position={index} tabbable={tabbable} />
    },
    [layout],
  )

  const clearFilters = () => {
    setText('')
    setFilter(defaultAllTopicsFilter)
  }

  return (
    <AllTopicsView
      query={text}
      onQueryChange={setText}
      filter={filter}
      counts={summary.counts}
      places={summary.places}
      onStatus={onStatus}
      onKind={onKind}
      onScope={onScope}
      onSort={onSort}
      ready={layout.ready}
      total={layout.total}
      rowKey={rowKey}
      renderRow={renderRow}
      onVisibleRange={onVisibleRange}
      listKey={JSON.stringify(layout.filter)}
      onClearFilters={clearFilters}
    />
  )
}

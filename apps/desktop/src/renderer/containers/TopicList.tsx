import { memo, useEffect, useRef } from 'react'
import { SIDEBAR_WINDOW } from '@juno/contract'
import {
  currentRowAtom,
  defaultTopicListFilter,
  nowAtom,
  registry,
  selectedTopicAtom,
  sidebarFilterAtom,
  sidebarRowAtom,
  sidebarSectionsAtom,
  topicSelectedAtom,
} from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomSet, useAtomValue } from '@juno/state/react'
import { relativeTime, TopicList as TopicListView, TopicRow as TopicRowView, type ActivateEvent, type TopicListEmpty } from '@juno/views'
import { takeFilterMark } from './filterMark'

// Row callbacks are created once and take the id, so no row ever receives
// a new function (performance.md 5.1).

/** Mouse down on a row: it becomes the selection. ⌘ asks for a new tab, which opens nothing until M4. */
function open(id: string, event: ActivateEvent): void {
  if (event.metaKey) {
    // TODO(M4): open the topic in a new tab.
    return
  }
  // TODO(M4): open the topic in the current tab. Until then the row is only marked.
  registry.set(selectedTopicAtom, id)
}

/** The Resolve check. */
function resolve(id: string): void {
  // TODO(M5): run the topic resolve command once the engine has one
  // (resolve, mark read, hide the row, toast with Undo). Nothing to call yet.
  void id
}

/** Pointer enter or keyboard focus on a row. */
function warm(id: string): void {
  // TODO(M4): prefetch(registry, messagesAtom(id)) once the topic query exists.
  void id
}

/** One row. Its atoms are keyed by id alone, so it keeps its state and DOM across filter changes. */
const Row = memo(function Row({ id }: { readonly id: string }) {
  const row = useAtomValue(sidebarRowAtom(id))
  const selected = useAtomValue(topicSelectedAtom(id))
  const tabbable = useAtomValue(currentRowAtom(id))
  const now = useAtomValue(nowAtom)
  if (row === undefined) return null
  return <TopicRowView row={row} time={relativeTime(row.lastActivityAt, now)} selected={selected} tabbable={tabbable} onOpen={open} onResolve={resolve} onPrefetch={warm} />
})

/**
 * The sidebar list. Subscribes to the shown window's order split into
 * sections only; each row subscribes to its own atom, so a delta that
 * touches one row re-renders one row. During a filter change the old rows
 * stay until the new window arrives (`sidebarListAtom`).
 */
export function TopicList() {
  const setFilter = useAtomSet(sidebarFilterAtom)
  const sections = useAtomValue(sidebarSectionsAtom)
  const { filter } = sections
  const painted = useRef(false)

  const count = sections.pinned.length + sections.recent.length

  useEffect(() => {
    if (!sections.ready) return
    if (!painted.current && count > 0) {
      painted.current = true
      afterPaint(() => measure('juno.sidebar-rows', 'juno.start', { detail: { rows: count } }))
    }
    if (takeFilterMark()) afterPaint(() => measure('juno.filter', 'juno.filter', { detail: { rows: count } }))
  }, [sections, count])

  const empty: TopicListEmpty | undefined = !sections.ready ? undefined : filter.unreadOnly ? 'caught-up' : filter.kind !== 'all' || filter.scope !== undefined ? 'filtered' : 'quiet'
  return (
    <TopicListView
      sections={[
        { id: 'pinned', ids: sections.pinned },
        { id: 'recent', ids: sections.recent },
      ]}
      renderRow={(id) => <Row key={id} id={id} />}
      {...(empty === undefined ? {} : { empty })}
      truncated={count >= SIDEBAR_WINDOW}
      onClearFilters={() => setFilter(defaultTopicListFilter)}
    />
  )
}

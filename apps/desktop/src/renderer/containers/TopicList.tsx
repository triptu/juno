import { memo, useEffect, useRef } from 'react'
import type { TopicRow as TopicRowModel } from '@juno/contract'
import {
  defaultTopicListFilter,
  nowAtom,
  registry,
  rowAtom,
  selectedTopicAtom,
  SIDEBAR_WINDOW,
  sidebarFilterAtom,
  sidebarSectionsAtom,
  topicListAtom,
  topicSelectedAtom,
  type ErrorOf,
  type LiveListAtom,
} from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomSet, useAtomValue } from '@juno/state/react'
import { relativeTime, TopicList as TopicListView, TopicRow as TopicRowView, type ActivateEvent, type TopicListEmpty } from '@juno/views'
import { takeFilterMark } from './filterMark'

type ListAtom = LiveListAtom<TopicRowModel, ErrorOf<typeof import('@juno/contract').topicsList>>

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

const Row = memo(function Row({ id, list, tabbable }: { readonly id: string; readonly list: ListAtom; readonly tabbable: boolean }) {
  const row = useAtomValue(rowAtom(list)(id))
  const selected = useAtomValue(topicSelectedAtom(id))
  const now = useAtomValue(nowAtom)
  if (row === undefined) return null
  return <TopicRowView row={row} time={relativeTime(row.lastActivityAt, now)} selected={selected} tabbable={tabbable} onOpen={open} onResolve={resolve} onPrefetch={warm} />
})

/**
 * The sidebar list. Subscribes to the window's order split into sections
 * only; each row subscribes to its own atom, so a delta that touches one
 * row re-renders one row.
 */
export function TopicList() {
  const filter = useAtomValue(sidebarFilterAtom)
  const setFilter = useAtomSet(sidebarFilterAtom)
  const list = topicListAtom(filter) as ListAtom
  const sections = useAtomValue(sidebarSectionsAtom(list))
  const selected = useAtomValue(selectedTopicAtom)
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
  const first = sections.pinned[0] ?? sections.recent[0]
  const shown = selected !== undefined && (sections.pinned.includes(selected) || sections.recent.includes(selected))
  const current = shown ? selected : first

  return (
    <TopicListView
      sections={[
        { id: 'pinned', ids: sections.pinned },
        { id: 'recent', ids: sections.recent },
      ]}
      renderRow={(id) => <Row key={id} id={id} list={list} tabbable={id === current} />}
      {...(empty === undefined ? {} : { empty })}
      truncated={count >= SIDEBAR_WINDOW}
      onClearFilters={() => setFilter(defaultTopicListFilter)}
    />
  )
}

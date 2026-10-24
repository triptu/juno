/**
 * The Search list's wiring (SPEC 10a): its rows from the engine's groups,
 * where it was scrolled (kept with the session for Back, ⌘⇧T and a
 * restart), the engine's 100-row window moved as the list nears either
 * end, and the arrows' next stops kept warm so the reader follows in one
 * frame.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import type { SearchSnapshot } from '@juno/contract'
import { loadMoreSearch, loadOlderMessages, prefetchSearchResult, registry, updateSearchSession, type SearchSelection, type SearchSession } from '@juno/state'
import { isStop, readerTarget, searchRows, type SearchRowItem } from '@juno/views'
import { openTopic, openTopicAt } from '../navigation'
import { justAfter } from '../slackLinks'

/** The engine sends 100 rows at a time; near either end the window moves by half. */
const WINDOW = 100
const WINDOW_STEP = 50

export function selectionOf(row: SearchRowItem | undefined): SearchSelection | undefined {
  const target = row === undefined ? undefined : readerTarget(row)
  if (row === undefined || target === undefined) return undefined
  return { id: row.id, topicId: target.topicId, ...(target.ts === undefined ? {} : { ts: target.ts }), ...(target.stored === undefined ? {} : { stored: target.stored }) }
}

/** The result at the match in this tab, as Enter opens it; Back returns to the search as it was. */
export async function openResultHere(target: SearchSelection): Promise<void> {
  if (target.ts === undefined) return openTopic(target.topicId)
  if (target.stored === false) await loadOlderMessages(registry, target.topicId, justAfter(target.ts))
  openTopicAt(target.topicId, target.ts, { flash: true })
}

/** Rows for the snapshot; undefined for an empty field. A search scoped to one thread shows all its matches. */
export function useResultRows(session: SearchSession, empty: boolean, snapshot: SearchSnapshot | undefined, grouped: boolean, expanded: ReadonlySet<string>) {
  const groups = snapshot?.groups
  const olderIndex = snapshot?.frontier.olderGroupIndex
  const scopedThread = session.topic?.threadTs !== undefined
  const rows = useMemo(() => {
    if (empty) return undefined
    if (groups === undefined) return []
    const open = scopedThread ? new Set([...expanded, ...groups.map((group) => group.id)]) : expanded
    return searchRows(groups, grouped, olderIndex ?? groups.length, open)
  }, [empty, groups, grouped, olderIndex, expanded, scopedThread])
  const stops = useMemo(() => (rows ?? []).filter(isStop), [rows])
  return { rows, stops }
}

/** The list comes back where it was left, and remembers where it is once a scroll ends. */
export function useListScroll(sessionId: string, listRef: RefObject<HTMLDivElement | null>, rows: ReadonlyArray<SearchRowItem> | undefined, scrollTop: number | undefined) {
  const restored = useRef(false)
  const ready = rows !== undefined && rows.length > 0
  useLayoutEffect(() => {
    const list = listRef.current
    if (restored.current || list === null || !ready) return
    restored.current = true
    if (scrollTop !== undefined) list.scrollTop = scrollTop
  }, [listRef, ready, scrollTop])
  const empty = rows === undefined
  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    const save = () => {
      const top = list.scrollTop
      updateSearchSession(registry, sessionId, (current) => (current.scrollTop === top ? current : { ...current, scrollTop: top }))
    }
    list.addEventListener('scrollend', save)
    return () => list.removeEventListener('scrollend', save)
  }, [sessionId, listRef, empty])
}

/** The engine's window: moved near either end, and asked for again where a restored session left it. */
export function useWindowPaging(sessionId: string, snapshot: SearchSnapshot | undefined, savedOffset: number) {
  const known = snapshot !== undefined
  const windowOffset = snapshot?.window.offset ?? 0
  useEffect(() => {
    if (!known || savedOffset === 0 || windowOffset === savedOffset) return
    void loadMoreSearch(registry, sessionId, savedOffset)
    // Once, when the first snapshot of a restored session arrives.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, known])
  const move = (next: number) => {
    updateSearchSession(registry, sessionId, (current) => ({ ...current, offset: next }))
    void loadMoreSearch(registry, sessionId, next)
  }
  return {
    nearEnd: () => {
      if (snapshot === undefined) return
      const { offset, totalRows } = snapshot.window
      const next = offset + WINDOW < totalRows ? offset + WINDOW_STEP : offset
      if (next !== offset) return move(next)
      if (snapshot.pagination.hasMore || !snapshot.frontier.complete) void loadMoreSearch(registry, sessionId, offset)
    },
    nearStart: () => {
      if (windowOffset > 0) move(Math.max(0, windowOffset - WINDOW_STEP))
    },
    windowKey: `${snapshot?.generation ?? 0}:${windowOffset}:${snapshot?.window.totalRows ?? 0}`,
  }
}

/** The stops before and after the selection are warm, so the arrows' next reader shows from the cache. */
export function useWarmNeighbours(selectedId: string | undefined, stops: ReadonlyArray<SearchRowItem>) {
  useEffect(() => {
    if (selectedId === undefined) return
    const at = stops.findIndex((row) => row.id === selectedId)
    for (const row of [stops[at - 1], stops[at + 1]]) {
      const target = row === undefined ? undefined : readerTarget(row)
      if (target !== undefined) prefetchSearchResult(registry, target.topicId, target.ts)
    }
  }, [selectedId, stops])
}

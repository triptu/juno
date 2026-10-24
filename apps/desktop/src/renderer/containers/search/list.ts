/**
 * The Search list's wiring (SPEC 10a): its rows from the engine's groups,
 * where it was scrolled (kept with the session for Back, ⌘⇧T and a
 * restart), the engine's 100-row window moved as the list nears either
 * end, and the arrows' next stops and the hovered row kept warm so the
 * reader follows in one frame.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { SearchSnapshot } from '@juno/contract'
import { loadMessageAt, loadMoreSearch, prefetchSearchResult, registry, updateSearchSession, type SearchSelection, type SearchSession } from '@juno/state'
import { isStop, readerTarget, searchRows, type SearchRowItem } from '@juno/views'
import { openTopic, openTopicAt } from '../navigation'

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
  if (target.stored === false) await loadMessageAt(registry, target.topicId, target.ts)
  openTopicAt(target.topicId, target.ts, { flash: true })
}

/** Rows for the snapshot; undefined for an empty field. A search scoped to one thread shows all its matches. */
export function useResultRows(session: SearchSession, empty: boolean, snapshot: SearchSnapshot | undefined, grouped: boolean, expanded: ReadonlySet<string>) {
  const groups = snapshot?.groups
  // The line shows where Slack's pages stop; before Slack's first page, or without Slack, the local rows show plainly.
  const olderIndex = snapshot === undefined || snapshot.pagination.page === 0 ? undefined : snapshot.frontier.olderGroupIndex
  const scopedThread = session.topic?.threadTs !== undefined
  const rows = useMemo(() => {
    if (empty) return undefined
    if (groups === undefined) return []
    const open = scopedThread ? new Set([...expanded, ...groups.map((group) => group.id)]) : expanded
    return searchRows(groups, grouped, olderIndex ?? groups.length, open)
  }, [empty, groups, grouped, olderIndex, expanded, scopedThread])
  const [held, setHeld] = useState({ source: rows, rows })
  let stable = held.rows
  if (rows !== held.source) {
    const cache = new Map(held.rows?.map((row) => [row.id, row]))
    stable = rows?.map((row) => {
      const previous = cache.get(row.id)
      return previous !== undefined && sameRow(previous, row) ? previous : row
    })
    setHeld({ source: rows, rows: stable })
  }
  const stops = useMemo(() => (stable ?? []).filter(isStop), [stable])
  return { rows: stable, stops }
}

/** The list comes back where it was left, and remembers where it is once a scroll ends. */
export function useListScroll(sessionId: string, listRef: RefObject<HTMLDivElement | null>, rows: ReadonlyArray<SearchRowItem> | undefined, scrollTop: number | undefined, windowReady: boolean) {
  const restored = useRef(false)
  const ready = windowReady && rows !== undefined && rows.length > 0
  useLayoutEffect(() => {
    const list = listRef.current
    if (restored.current || list === null || !ready) return
    restored.current = true
    if (scrollTop !== undefined) list.scrollTop = scrollTop
  }, [listRef, ready, scrollTop])
  const empty = rows === undefined
  useEffect(() => {
    const list = listRef.current
    if (list === null || !windowReady) return
    const save = () => {
      const top = list.scrollTop
      updateSearchSession(registry, sessionId, (current) => (current.scrollTop === top ? current : { ...current, scrollTop: top }))
    }
    list.addEventListener('scrollend', save)
    return () => list.removeEventListener('scrollend', save)
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- The empty-to-ready transition is when the list DOM appears.
  }, [sessionId, listRef, empty, windowReady])
}

/** The engine's window: moved near either end, and asked for again where a restored session left it. */
export function useWindowPaging(sessionId: string, snapshot: SearchSnapshot | undefined, savedOffset: number) {
  const restoring = useRef(savedOffset > 0 ? savedOffset : undefined)
  const known = snapshot !== undefined
  const windowOffset = snapshot?.window.offset ?? 0
  useEffect(() => {
    if (!known || savedOffset === 0 || windowOffset === savedOffset) return
    void loadMoreSearch(registry, sessionId, savedOffset)
    // Once, when the first snapshot of a restored session arrives.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, known])
  useEffect(() => {
    if (snapshot === undefined) return
    if (restoring.current !== undefined && windowOffset !== restoring.current) return
    restoring.current = undefined
    updateSearchSession(registry, sessionId, (current) => current.offset === windowOffset ? current : { ...current, offset: windowOffset })
  }, [sessionId, snapshot, savedOffset, windowOffset])
  const move = (next: number) => { void loadMoreSearch(registry, sessionId, next) }
  return {
    nearEnd: () => {
      if (snapshot === undefined || restoring.current !== undefined) return
      const { offset, totalRows } = snapshot.window
      const next = offset + WINDOW < totalRows ? offset + WINDOW_STEP : offset
      if (next !== offset) return move(next)
      if (snapshot.state !== 'searching' && snapshot.state !== 'slackUnavailable' && (snapshot.pagination.hasMore || snapshot.window.hasMoreLocal)) void loadMoreSearch(registry, sessionId)
    },
    nearStart: () => {
      if (restoring.current === undefined && windowOffset > 0) move(Math.max(0, windowOffset - WINDOW_STEP))
    },
    windowKey: `${snapshot?.generation ?? 0}:${windowOffset}:${snapshot?.window.totalRows ?? 0}:${snapshot?.state ?? 'pending'}`,
  }
}

/**
 * The stops before and after the selection are warm, so the arrows' next reader shows from the cache, and so is
 * the row under the pointer (the returned call). Three prefetch entries in all (performance 4.2).
 */
export function useWarmNeighbours(sessionId: string, generation: number, selectedId: string | undefined, stops: ReadonlyArray<SearchRowItem>) {
  useEffect(() => {
    if (selectedId === undefined) return
    const at = stops.findIndex((row) => row.id === selectedId)
    for (const row of [stops[at - 1], stops[at + 1]]) warmRow(sessionId, generation, row)
  }, [sessionId, generation, selectedId, stops])
  return useCallback((id: string) => warmRow(sessionId, generation, stops.find((row) => row.id === id)), [sessionId, generation, stops])
}

function warmRow(sessionId: string, generation: number, row: SearchRowItem | undefined): void {
  const target = row === undefined ? undefined : readerTarget(row)
  if (target !== undefined) prefetchSearchResult(registry, sessionId, generation, target)
}

function sameRow(a: SearchRowItem, b: SearchRowItem): boolean {
  return a.kind === b.kind && (a.kind !== 'match' || b.kind !== 'match' || a.flat === b.flat) && (!('group' in a) || ('group' in b && a.group === b.group)) && (!('hit' in a) || ('hit' in b && a.hit === b.hit)) && (!('count' in a) || ('count' in b && a.count === b.count))
}

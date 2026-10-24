/**
 * A Search tab (SPEC 10a, `docs/design/search/README.md`): the session's
 * field, filters and results wired to `SearchPage`, and the reader beside
 * them. The session lives in `searchSessionAtom`, so Back, ⌘⇧T and a
 * restart bring back the query, the selection and the scroll; the results
 * are fetched again.
 */
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { SEARCH_COLUMN_WIDTH, type SearchSnapshot } from '@juno/contract'
import {
  forgetSearch,
  loadMoreSearch,
  nowAtom,
  recentSearchesAtom,
  registry,
  rememberSearch,
  searchFocusAtom,
  searchIsEmpty,
  searchPrefsAtom,
  searchResultsAtom,
  searchSessionAtom,
  setSearchPrefs,
  updateSearchSession,
  type SearchSession,
} from '@juno/state'
import { afterPaint, measure } from '@juno/state/perf'
import { useAtomValue } from '@juno/state/react'
import { searchTime, SearchField, SearchFilters, SearchPage, SearchResults, searchRowDomId, type SearchRowItem, type SearchToggle } from '@juno/views'
import { openPalette } from '../paletteActions'
import { chipViewsOf, useSearchField } from './field'
import { openResultHere, selectionOf, useListScroll, useResultRows, useWarmNeighbours, useWindowPaging } from './list'
import { showFilterMenu } from './menus'
import { moveReader, openResultBehind, SearchReader } from './Reader'

/** Focus requests already taken, by session: a page shown again does not take focus twice. */
const focusTaken = new Map<string, number>()

const update = (id: string, change: (session: SearchSession) => SearchSession) => updateSearchSession(registry, id, change)

const focusRow = (id: string | undefined): boolean => {
  const row = id === undefined ? null : document.getElementById(searchRowDomId(id))
  if (row === null) return false
  row.focus({ preventScroll: true })
  row.scrollIntoView({ block: 'nearest' })
  return true
}

interface ListContext {
  readonly sessionId: string
  readonly session: SearchSession
  readonly rows: ReadonlyArray<SearchRowItem> | undefined
  readonly stops: ReadonlyArray<SearchRowItem>
  readonly narrow: boolean
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly setReaderShown: (shown: boolean) => void
  /** A row was chosen, so the first-result peek leaves the selection alone. */
  readonly onChosen: () => void
}

/** What the list's rows do: select (the reader follows), open here or behind, and the moves between the list, the field and the reader. */
function useListActions({ sessionId, session, rows, stops, narrow, inputRef, setReaderShown, onChosen }: ListContext) {
  const currentRows = useRef(rows)
  useLayoutEffect(() => { currentRows.current = rows }, [rows])
  const find = useCallback((id: string) => selectionOf(currentRows.current?.find((candidate) => candidate.id === id)), [])
  const select = useCallback((id: string, how: 'pointer' | 'keyboard') => {
    const selection = find(id)
    if (selection === undefined) return
    onChosen()
    // A row that takes focus selects itself; the arrows and a press have already selected it.
    if (how === 'keyboard' && registry.get(searchSessionAtom(sessionId)).selected?.id === id) return
    if (narrow && how === 'pointer') setReaderShown(true)
    moveReader(sessionId, selection, how)
    update(sessionId, (current) => ({ ...current, selected: selection }))
  }, [find, narrow, sessionId, setReaderShown, onChosen])
  const open = useCallback((id: string, { newTab }: { readonly newTab: boolean }) => {
    const selection = find(id)
    if (selection === undefined) return
    rememberSearch(registry, sessionId)
    if (newTab) return void openResultBehind(selection)
    if (selection.id !== registry.get(searchSessionAtom(sessionId)).selected?.id) select(id, 'pointer')
    if (narrow) return setReaderShown(true)
    void openResultHere(selection)
  }, [find, narrow, select, sessionId, setReaderShown])
  /** ↓ in the field: the selected row, or the first. */
  const toList = () => {
    const id = session.selected !== undefined && stops.some((row) => row.id === session.selected?.id) ? session.selected.id : stops[0]?.id
    if (id === undefined) return
    if (session.selected?.id !== id) select(id, 'keyboard')
    afterPaint(() => focusRow(id))
  }
  return {
    select,
    open,
    backToResults: () => {
      setReaderShown(false)
      afterPaint(() => focusRow(session.selected?.id) || inputRef.current?.focus())
    },
    /** The field's keys: Enter asks Slack now and keeps the search as a recent one; ↓ goes to the list. */
    fieldKey: (event: KeyboardEvent<HTMLInputElement>, picker: { readonly open: boolean; readonly close: () => void }) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        rememberSearch(registry, sessionId)
        return update(sessionId, (current) => ({ ...current, commit: current.commit + 1 }))
      }
      if (event.key === 'ArrowDown' && !event.metaKey) {
        event.preventDefault()
        return toList()
      }
      if (event.key === 'Escape' && picker.open) picker.close()
    },
    step: (ts: string) => {
      const row = rows?.find((candidate) => (candidate.kind === 'flat' || candidate.kind === 'match') && candidate.hit.ts === ts)
      const selected = session.selected
      if (selected === undefined) return
      const next = { ...selected, ts, ...(row === undefined ? {} : { id: row.id }) }
      moveReader(sessionId, next, 'step')
      update(sessionId, (current) => ({ ...current, selected: next }))
    },
  }
}

/** ⌘↑ ⌘↓ step the reader's matches from the list or the field; Esc in the one-column reader goes back to the list. */
function usePageKeys(readerRef: RefObject<HTMLDivElement | null>, narrow: boolean, step: (direction: 1 | -1) => void, back: () => void) {
  const onKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    const inText = event.target instanceof HTMLTextAreaElement
    if (event.metaKey && !event.shiftKey && !event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !inText) {
      event.preventDefault()
      step(event.key === 'ArrowUp' ? -1 : 1)
    } else if (event.key === 'Escape' && !event.defaultPrevented && narrow && !inText && readerRef.current?.contains(event.target as Node) === true) {
      back()
    }
  })
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Until a row is chosen, each new search's first result shows in the reader
 * as a peek: it marks nothing read (the reader marks read only when used)
 * and focus stays where it is. It waits for Slack's answer, which can put a
 * newer match first. Returns what a choice calls.
 */
function usePeekFirst(sessionId: string, selectedId: string | undefined, stops: ReadonlyArray<SearchRowItem>, snapshot: SearchSnapshot | undefined) {
  const generation = snapshot === undefined || snapshot.state === 'searching' ? undefined : snapshot.generation
  const peeked = useRef<number | undefined>(undefined)
  const chosen = useRef(selectedId !== undefined)
  const first = stops[0]
  useEffect(() => {
    if (chosen.current && selectedId !== undefined) return
    if (first === undefined || generation === undefined || peeked.current === generation) return
    const selection = selectionOf(first)
    if (selection === undefined) return
    peeked.current = generation
    chosen.current = false
    if (selection.id !== selectedId) update(sessionId, (current) => ({ ...current, selected: selection }))
  }, [sessionId, selectedId, first, generation])
  return useCallback(() => {
    chosen.current = true
  }, [])
}

/** The field takes focus when asked (⌘⇧F, the magnifier, a new Search tab); and a keystroke's rows are measured once painted. */
function useFieldFocus(sessionId: string, inputRef: RefObject<HTMLInputElement | null>) {
  const request = useAtomValue(searchFocusAtom(sessionId))
  useEffect(() => {
    if (request === 0 || focusTaken.get(sessionId) === request) return
    focusTaken.set(sessionId, request)
    inputRef.current?.focus()
  }, [sessionId, request, inputRef])
}

function useResultsMeasure(generation: number | undefined, current: boolean, rows: number) {
  const keystroke = useRef<number | undefined>(undefined)
  useEffect(() => {
    const at = keystroke.current
    if (at === undefined || !current) return
    keystroke.current = undefined
    afterPaint(() => measure('juno.search-results', at, { detail: { rows } }))
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- A new generation completes the measure even when the row count is unchanged.
  }, [generation, current, rows])
  return useCallback(() => {
    keystroke.current = performance.now()
  }, [])
}

/** Which filters the field sets, for the filter row's set look. ⌘F's topic is an In. */
const filtersSet = (session: SearchSession) => {
  const has = (op: SearchSession['chips'][number]['op']) => session.chips.some((chip) => chip.op === op)
  return { from: has('from'), in: has('in') || session.topic !== undefined, date: has('date'), has: has('has') }
}

function togglePref(which: SearchToggle, prefs: { readonly groupByThread: boolean; readonly hideApps: boolean; readonly hideAutomated: boolean }): void {
  setSearchPrefs(registry, which === 'group' ? { groupByThread: !prefs.groupByThread } : which === 'apps' ? { hideApps: !prefs.hideApps } : { hideAutomated: !prefs.hideAutomated })
}

interface ColumnProps {
  readonly sessionId: string
  readonly session: SearchSession
  readonly snapshot: SearchSnapshot | undefined
  readonly prefs: { readonly hideApps: boolean; readonly hideAutomated: boolean }
  readonly rows: ReadonlyArray<SearchRowItem> | undefined
  readonly empty: boolean
  readonly listRef: RefObject<HTMLDivElement | null>
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly readerRef: RefObject<HTMLDivElement | null>
  readonly narrow: boolean
  readonly readerShown: boolean
  readonly listFocused: boolean
  readonly actions: ReturnType<typeof useListActions>
  readonly paging: ReturnType<typeof useWindowPaging>
  readonly setText: (text: string, change?: (current: SearchSession) => SearchSession) => void
  readonly onExpand: (groupId: string) => void
}

/** The results column: the rows and states for the query, or the recent searches on an empty field. */
function ResultsColumn({ sessionId, session, snapshot, prefs, rows, empty, listRef, inputRef, readerRef, narrow, readerShown, listFocused, actions, paging, setText, onExpand }: ColumnProps) {
  const recent = useAtomValue(recentSearchesAtom)
  return (
    <SearchResults
      rows={rows}
      state={snapshot === undefined ? 'pending' : snapshot.state}
      words={session.text}
      filtered={session.chips.length > 0 || session.topic !== undefined}
      hidden={{ count: snapshot?.counts.hidden ?? 0, apps: prefs.hideApps, automated: prefs.hideAutomated }}
      note={empty ? undefined : snapshot?.query.diagnostics.find((diagnostic) => diagnostic.code !== 'incomplete')?.message}
      selectedId={session.selected?.id}
      focused={listFocused}
      time={SearchTime}
      recent={recent.map((search) => ({ text: search.text, chips: chipViewsOf(search.chips) }))}
      listRef={listRef}
      onSelect={actions.select}
      onOpen={actions.open}
      onExpand={onExpand}
      onLeaveTop={() => inputRef.current?.focus()}
      onTab={() => {
        const composer = readerRef.current?.querySelector<HTMLTextAreaElement>('[data-composer] textarea')
        if (composer == null || (narrow && !readerShown)) return false
        composer.focus()
        return true
      }}
      onType={(key) => {
        inputRef.current?.focus()
        if (key.length === 1) setText(session.text + key)
      }}
      onTryAgain={() => void loadMoreSearch(registry, sessionId)}
      onClearFilters={() => update(sessionId, ({ topic: _topic, ...current }) => ({ ...current, chips: [] }))}
      onShowHidden={() => setSearchPrefs(registry, { hideApps: false, hideAutomated: false })}
      onRecent={(index) => {
        const chosen = recent[index]
        if (chosen !== undefined) setText(chosen.text, (current) => ({ ...current, chips: chosen.chips, commit: current.commit + 1 }))
        inputRef.current?.focus()
      }}
      onForgetRecent={(index) => forgetSearch(registry, index)}
      onPalette={openPalette}
      onNearEnd={paging.nearEnd}
      onNearStart={paging.nearStart}
      windowKey={paging.windowKey}
    />
  )
}

export function SearchTab({ sessionId }: { readonly tabId: string; readonly sessionId: string }) {
  const session = useAtomValue(searchSessionAtom(sessionId))
  const prefs = useAtomValue(searchPrefsAtom)
  const results = useAtomValue(searchResultsAtom(sessionId))
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const readerRef = useRef<HTMLDivElement>(null)
  const stepper = useRef<((direction: 1 | -1) => void) | undefined>(undefined)
  const [listFocused, setListFocused] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [readerShown, setReaderShown] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const expand = useCallback((groupId: string) => setExpanded((current) => new Set([...current, groupId])), [])

  const snapshot = results?.snapshot
  const empty = searchIsEmpty(session)
  const { rows, stops } = useResultRows(session, empty, snapshot, prefs.groupByThread, expanded)
  const edited = useResultsMeasure(snapshot?.generation, results?.current === true, rows?.length ?? 0)
  const { field, typeOperator, setText, pickerOpen, closePicker } = useSearchField(sessionId, session, inputRef, edited)
  const paging = useWindowPaging(sessionId, snapshot, session.offset ?? 0)
  useFieldFocus(sessionId, inputRef)
  useListScroll(sessionId, listRef, rows, session.scrollTop, snapshot?.window.offset === (session.offset ?? 0))
  useWarmNeighbours(session.selected?.id, stops)
  const onChosen = usePeekFirst(sessionId, session.selected?.id, stops, snapshot)
  const actions = useListActions({ sessionId, session, rows, stops, narrow, inputRef, setReaderShown, onChosen })
  const onStepper = useCallback((step: ((direction: 1 | -1) => void) | undefined) => {
    stepper.current = step
  }, [])
  const stepBy = useCallback((direction: 1 | -1) => stepper.current?.(direction), [])

  usePageKeys(readerRef, narrow, stepBy, actions.backToResults)

  return (
    <SearchPage
      field={<SearchField {...field} onKeyDown={(event) => actions.fieldKey(event, { open: pickerOpen, close: closePicker })} />}
      filters={
        <SearchFilters
          set={filtersSet(session)}
          sort={session.sort}
          groupByThread={prefs.groupByThread}
          hideApps={prefs.hideApps}
          hideAutomated={prefs.hideAutomated}
          onMenu={(menu, at) => void showFilterMenu(sessionId, session, snapshot?.facets, menu, at, typeOperator).then((changed) => changed && edited())}
          onToggle={(which) => {
            edited()
            togglePref(which, prefs)
          }}
        />
      }
      results={<ResultsColumn {...{ sessionId, session, snapshot, prefs, rows, empty, listRef, inputRef, readerRef, narrow, readerShown, listFocused, actions, paging, setText }} onExpand={expand} />}
      reader={
        <SearchReader
          sessionId={sessionId}
          selection={empty ? undefined : session.selected}
          snapshot={snapshot}
          narrow={narrow}
          readerRef={readerRef}
          onStepper={onStepper}
          onBack={actions.backToResults}
          onEscape={() => focusRow(session.selected?.id) || inputRef.current?.focus()}
          onStep={actions.step}
          onUsed={() => rememberSearch(registry, sessionId)}
        />
      }
      readerRef={readerRef}
      readerShown={readerShown}
      columnWidth={prefs.column}
      onResizeColumn={(width) => setSearchPrefs(registry, { column: width })}
      onResetColumn={() => setSearchPrefs(registry, { column: SEARCH_COLUMN_WIDTH.default })}
      onNarrow={setNarrow}
      onListFocus={setListFocused}
    />
  )
}

function SearchTime({ at }: { readonly at: number }) {
  const now = useAtomValue(nowAtom, (time) => Math.floor(time / 60_000) * 60_000)
  return searchTime(at, now)
}

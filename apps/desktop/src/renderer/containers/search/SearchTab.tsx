/**
 * A Search tab (SPEC 10a, `docs/design/search/README.md`): the session's
 * field, filters and result cards wired to `SearchPage`, and the selected
 * card's topic in the panel beside them once asked for. The session lives
 * in `searchSessionAtom`, so Back, ⌘⇧T and a restart bring back the query,
 * the selection, whether the panel shows, and the scroll; the results are
 * fetched again.
 */
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { SEARCH_PANEL_WIDTH, type SearchSnapshot } from '@juno/contract'
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
import { wantComposerFocus } from '../pageFocus'
import { openPalette } from '../paletteActions'
import { messageLinkInfo, openMessageLink } from '../slackLinks'
import { chipViewsOf, useSearchField } from './field'
import { openResultHere, selectionOf, useListScroll, useResultRows, useWarmNeighbours, useWindowPaging } from './list'
import { showFilterMenu } from './menus'
import { moveReader, openResultBehind, readerView, SearchReader } from './Reader'

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
}

/**
 * What the cards do: select (the panel, when it shows, follows), show and
 * hide the topic beside them, open here or behind, and the moves between
 * the list, the field and the panel.
 */
function useListActions({ sessionId, session, rows, stops, narrow, inputRef }: ListContext) {
  const currentRows = useRef(rows)
  useLayoutEffect(() => { currentRows.current = rows }, [rows])
  const find = useCallback((id: string) => selectionOf(currentRows.current?.find((candidate) => candidate.id === id)), [])
  const current = useCallback(() => registry.get(searchSessionAtom(sessionId)), [sessionId])
  const select = useCallback((id: string, how: 'pointer' | 'keyboard') => {
    const selection = find(id)
    if (selection === undefined) return
    const now = current()
    // A card that takes focus selects itself; the arrows and a press have already selected it.
    if (how === 'keyboard' && now.selected?.id === id) return
    if (now.panel === true) moveReader(sessionId, selection, how)
    update(sessionId, (session) => ({ ...session, selected: selection }))
  }, [find, current, sessionId])
  /** The card's topic beside the list, or over it in a narrow page. */
  const show = useCallback((id: string, how: 'pointer' | 'keyboard') => {
    const selection = find(id)
    if (selection === undefined) return
    const now = current()
    if (now.panel !== true || now.selected?.id !== id) moveReader(sessionId, selection, how)
    update(sessionId, (session) => ({ ...session, selected: selection, panel: true }))
  }, [find, current, sessionId])
  /** The panel goes and the selected card takes focus. False when there was no panel. */
  const hide = useCallback((): boolean => {
    const now = current()
    if (now.panel !== true) return false
    update(sessionId, (session) => ({ ...session, panel: false }))
    afterPaint(() => focusRow(now.selected?.id) || inputRef.current?.focus())
    return true
  }, [current, sessionId, inputRef])
  const open = useCallback((id: string, { newTab }: { readonly newTab: boolean }) => {
    const selection = find(id)
    if (selection === undefined) return
    rememberSearch(registry, sessionId)
    if (newTab) return void openResultBehind(selection)
    // A narrow page has no room beside the list: Enter shows the topic over it, with Back to results.
    if (narrow) return show(id, 'keyboard')
    if (selection.id !== current().selected?.id) update(sessionId, (session) => ({ ...session, selected: selection }))
    void openResultHere(selection)
  }, [find, current, narrow, show, sessionId])
  /**
   * ↓ in the field: the selected card, or the first. It takes focus in the same keydown, as the arrows in the list
   * do, so a key pressed straight after (Space) is the card's and never types into the field. A card not drawn
   * yet takes it after the next paint.
   */
  const toList = () => {
    const id = session.selected !== undefined && stops.some((row) => row.id === session.selected?.id) ? session.selected.id : stops[0]?.id
    if (id === undefined) return
    if (session.selected?.id !== id) select(id, 'keyboard')
    if (!focusRow(id)) afterPaint(() => focusRow(id))
  }
  return {
    select,
    open,
    hide,
    press: (id: string) => show(id, 'pointer'),
    showTopic: (id: string) => show(id, 'keyboard'),
    toggleTopic: (id: string) => {
      const now = current()
      if (now.panel === true && now.selected?.id === id) hide()
      else show(id, 'keyboard')
    },
    /** The field's keys: Enter asks Slack now and keeps the search as a recent one; ↓ goes to the list; Esc hides the panel. */
    fieldKey: (event: KeyboardEvent<HTMLInputElement>, picker: { readonly open: boolean; readonly close: () => void }) => fieldKey(sessionId, event, picker, toList),
    step: (ts: string) => {
      const row = rows?.find((candidate) => candidate.kind === 'card' && candidate.hit.ts === ts)
      const selected = session.selected
      if (selected === undefined) return
      const next = { ...selected, ts, ...(row === undefined ? {} : { id: row.id }) }
      moveReader(sessionId, next, 'step')
      update(sessionId, (now) => ({ ...now, selected: next }))
    },
  }
}

function fieldKey(sessionId: string, event: KeyboardEvent<HTMLInputElement>, picker: { readonly open: boolean; readonly close: () => void }, toList: () => void): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    rememberSearch(registry, sessionId)
    update(sessionId, (now) => ({ ...now, commit: now.commit + 1 }))
  } else if (event.key === 'ArrowDown' && !event.metaKey) {
    event.preventDefault()
    toList()
  } else if (event.key === 'Escape' && picker.open) {
    picker.close()
  } else if (event.key === 'Escape' && registry.get(searchSessionAtom(sessionId)).panel === true) {
    event.preventDefault()
    update(sessionId, (now) => ({ ...now, panel: false }))
  }
}

/** ⌘↑ ⌘↓ step the panel's matches from the list or the field; Esc in the panel hides it. */
function usePageKeys(readerRef: RefObject<HTMLDivElement | null>, step: (direction: 1 | -1) => void, hide: () => void) {
  const onKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    const inText = event.target instanceof HTMLTextAreaElement
    if (event.metaKey && !event.shiftKey && !event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !inText) {
      event.preventDefault()
      step(event.key === 'ArrowUp' ? -1 : 1)
    } else if (event.key === 'Escape' && !event.defaultPrevented && !inText && readerRef.current?.contains(event.target as Node) === true) {
      hide()
    }
  })
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * A newer query whose results do not hold the selected card drops the
 * selection and the panel, so the panel never shows a topic the list no
 * longer has. Each selection remembers the query it was made in; a
 * restored one, the first query the page shows.
 */
function useDropStale(sessionId: string, selectedId: string | undefined, stops: ReadonlyArray<SearchRowItem>, snapshot: SearchSnapshot | undefined) {
  const generation = snapshot?.generation
  const settled = snapshot !== undefined && snapshot.state !== 'searching' ? snapshot.generation : undefined
  const chosen = useRef<{ id: string | undefined; at: number | undefined }>({ id: selectedId, at: undefined })
  useEffect(() => {
    if (chosen.current.id !== selectedId) chosen.current = { id: selectedId, at: generation }
    else if (chosen.current.at === undefined) chosen.current = { id: selectedId, at: generation }
    const at = chosen.current.at
    if (settled === undefined || at === undefined || settled <= at || selectedId === undefined || stops.some((row) => row.id === selectedId)) return
    update(sessionId, ({ selected: _selected, panel: _panel, ...rest }) => rest)
  }, [sessionId, selectedId, stops, settled, generation])
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

function togglePref(which: SearchToggle, prefs: { readonly hideApps: boolean; readonly hideAutomated: boolean }): void {
  setSearchPrefs(registry, which === 'apps' ? { hideApps: !prefs.hideApps } : { hideAutomated: !prefs.hideAutomated })
}

/** The words the query searches for, marked in the cards and the panel. */
const wordsOf = (snapshot: SearchSnapshot | undefined): ReadonlyArray<string> =>
  (snapshot?.query.clauses ?? []).flatMap((clause) => ((clause.kind === 'term' || clause.kind === 'phrase') && !clause.negated ? [clause.value] : []))

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
  readonly panelShown: boolean
  readonly listFocused: boolean
  readonly actions: ReturnType<typeof useListActions>
  readonly paging: ReturnType<typeof useWindowPaging>
  readonly setText: (text: string, change?: (current: SearchSession) => SearchSession) => void
  readonly onHoverRow: (id: string) => void
}

/** The results: the cards and states for the query, or the recent searches on an empty field. */
function ResultsColumn({ sessionId, session, snapshot, prefs, rows, empty, listRef, inputRef, readerRef, panelShown, listFocused, actions, paging, setText, onHoverRow }: ColumnProps) {
  const recent = useAtomValue(recentSearchesAtom)
  const marks = wordsOf(snapshot)
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
      marks={marks}
      time={SearchTime}
      recent={recent.map((search) => ({ text: search.text, chips: chipViewsOf(search.chips) }))}
      listRef={listRef}
      onSelect={actions.select}
      onPress={actions.press}
      onOpen={actions.open}
      onToggleTopic={actions.toggleTopic}
      onShowTopic={actions.showTopic}
      onHideTopic={actions.hide}
      onLink={openMessageLink}
      linkInfo={messageLinkInfo}
      onHoverRow={onHoverRow}
      onLeaveTop={() => inputRef.current?.focus()}
      onTab={() => {
        const shown = session.selected
        if (!panelShown || shown === undefined) return false
        const composer = readerRef.current?.querySelector<HTMLTextAreaElement>('[data-composer] textarea')
        if (composer != null) {
          composer.focus()
          return true
        }
        // The reader shows its composer once the draft has loaded; until then Tab asks for it, and it takes focus as it
        // mounts unless a key or the pointer was pressed since (pageFocus.ts).
        wantComposerFocus(readerView(sessionId, shown.topicId))
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

  const snapshot = results?.snapshot
  const empty = searchIsEmpty(session)
  const { rows, stops } = useResultRows(empty, snapshot)
  const edited = useResultsMeasure(snapshot?.generation, results?.current === true, rows?.length ?? 0)
  const { field, typeOperator, setText, pickerOpen, closePicker } = useSearchField(sessionId, session, inputRef, edited)
  const paging = useWindowPaging(sessionId, snapshot, session.offset ?? 0)
  useFieldFocus(sessionId, inputRef)
  useListScroll(sessionId, listRef, rows, session.scrolled, snapshot?.window.offset === (session.offset ?? 0))
  const warmRow = useWarmNeighbours(sessionId, snapshot?.generation ?? 0, session.selected?.id, stops)
  useDropStale(sessionId, session.selected?.id, stops, snapshot)
  const actions = useListActions({ sessionId, session, rows, stops, narrow, inputRef })
  const onStepper = useCallback((step: ((direction: 1 | -1) => void) | undefined) => {
    stepper.current = step
  }, [])
  const stepBy = useCallback((direction: 1 | -1) => stepper.current?.(direction), [])
  const panelShown = !empty && session.panel === true && session.selected !== undefined

  usePageKeys(readerRef, stepBy, actions.hide)

  return (
    <SearchPage
      field={<SearchField {...field} onKeyDown={(event) => actions.fieldKey(event, { open: pickerOpen, close: closePicker })} />}
      filters={
        <SearchFilters
          set={filtersSet(session)}
          sort={session.sort}
          hideApps={prefs.hideApps}
          hideAutomated={prefs.hideAutomated}
          onMenu={(menu, at) => void showFilterMenu(sessionId, session, snapshot?.facets, menu, at, typeOperator).then((changed) => changed && edited())}
          onToggle={(which) => {
            edited()
            togglePref(which, prefs)
          }}
        />
      }
      results={<ResultsColumn {...{ sessionId, session, snapshot, prefs, rows, empty, listRef, inputRef, readerRef, panelShown, listFocused, actions, paging, setText }} onHoverRow={warmRow} />}
      reader={
        panelShown ? (
          <SearchReader
            sessionId={sessionId}
            selection={session.selected}
            row={rows?.find((row) => row.id === session.selected?.id)}
            snapshot={snapshot}
            narrow={narrow}
            readerRef={readerRef}
            onStepper={onStepper}
            onBack={actions.hide}
            onEscape={() => focusRow(session.selected?.id) || inputRef.current?.focus()}
            onStep={actions.step}
            onUsed={() => rememberSearch(registry, sessionId)}
          />
        ) : null
      }
      readerRef={readerRef}
      panelShown={panelShown}
      panelWidth={prefs.panel}
      onResizePanel={(width) => setSearchPrefs(registry, { panel: width })}
      onResetPanel={() => setSearchPrefs(registry, { panel: SEARCH_PANEL_WIDTH.default })}
      onNarrow={setNarrow}
      onListFocus={setListFocused}
    />
  )
}

function SearchTime({ at, short }: { readonly at: number; readonly short?: boolean }) {
  const now = useAtomValue(nowAtom, (time) => Math.floor(time / 60_000) * 60_000)
  return searchTime(at, now, short)
}

/**
 * The Search tab's results column (SPEC 10a, inventory 9a): the rows of
 * `searchRows`, the states, and on an empty field the recent searches.
 * Dumb: the owner keeps the selection and runs what is chosen.
 *
 * - A press selects a row and the reader follows; ⌘-press opens it in a tab
 *   behind this one and the selection stays.
 * - ↑ and ↓ move the selection and focus with it; ↑ on the first row goes
 *   back to the field. Enter opens the row, ⌘Enter in a tab behind. Tab
 *   goes on to the reader's composer when the owner has one. A character
 *   typed goes to the field.
 * - Rows are in flow with `content-visibility: auto`. The owner moves the
 *   engine's 100-row window when the list nears either end.
 */
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useEffectEvent, useRef, type ComponentType, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react'
import type { SearchSnapshot } from '@juno/contract'
import { colors, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Button } from '@juno/ui'
import { isStop, type SearchRowItem } from './rows'
import { SearchRecent, type SearchRecentProps } from './SearchRecent'
import { SearchRow, searchRowDomId } from './SearchRow'

/** What the list shows besides rows. `pending`: the query's first answer has not come. */
export type SearchListState = SearchSnapshot['state'] | 'pending'

export interface SearchResultsProps extends SearchRecentProps {
  /** Rows, from `searchRows`. Undefined while the field is empty: the recent searches show. */
  readonly rows: ReadonlyArray<SearchRowItem> | undefined
  readonly state: SearchListState
  /** The typed words, for "Nothing matches …". */
  readonly words: string
  /** A filter or chip is set, so the empty state offers Clear filters. */
  readonly filtered: boolean
  /** How many hidden rows would match, for the onlyHidden state, and which toggles hide them. */
  readonly hidden: { readonly count: number; readonly apps: boolean; readonly automated: boolean }
  /** An operator the search does not support, said quietly over the rows. */
  readonly note?: string | undefined
  readonly selectedId: string | undefined
  /** The list or the field has focus: the selected row takes the nav tint. */
  readonly focused: boolean
  readonly now?: number
  readonly time?: ComponentType<{ at: number }>
  readonly listRef?: Ref<HTMLDivElement>
  /** A row chosen by a press or by the arrows. */
  readonly onSelect: (id: string, how: 'pointer' | 'keyboard') => void
  readonly onOpen: (id: string, options: { readonly newTab: boolean }) => void
  readonly onExpand: (groupId: string) => void
  /** The pointer came onto a row: warm what the reader would show for it. */
  readonly onHoverRow?: (id: string) => void
  /** ↑ on the first row. */
  readonly onLeaveTop: () => void
  /** Tab from a row; true when the owner moved focus on. */
  readonly onTab: () => boolean
  /** A character typed on a row, for the field. */
  readonly onType: (key: string) => void
  readonly onTryAgain: () => void
  readonly onClearFilters: () => void
  readonly onShowHidden: () => void
  /** The list nears its end or its start: the owner moves the window or asks for a page. */
  readonly onNearEnd?: () => void
  readonly onNearStart?: () => void
  /** Changes when the engine's window moves, so a sentinel still in view asks again. */
  readonly windowKey?: string
}

const copy = {
  unavailable: "Showing matches on this Mac. Slack search didn't answer.",
  offline: "You're offline. Showing matches on this Mac.",
  offlineEmpty: "You're offline. Nothing on this Mac matches.",
  searching: 'Searching Slack…',
}

export function SearchResults(props: SearchResultsProps) {
  const { rows, listRef } = props
  return (
    <>
      {/* Always there, before the list, so screen readers announce the state lines as their text changes. */}
      <p role="status" data-sensitive="" {...stylex.props(styles.live)}>{stateLine(props)}</p>
      <div ref={listRef} data-scroll-area="" data-search-results="" {...stylex.props(styles.scroller)}>
        <div {...stylex.props(styles.column)}>{rows === undefined ? <SearchRecent {...props} /> : <Results {...props} rows={rows} />}</div>
      </div>
    </>
  )
}

/** The state the list is in, in words: what its notices and its "Searching Slack…" line say. */
function stateLine({ rows, state, words, filtered, hidden }: SearchResultsProps): string {
  if (rows === undefined || state === 'pending') return ''
  const empty = rows.length === 0
  if (state === 'searching') return copy.searching
  if (state === 'slackUnavailable') return copy.unavailable
  if (state === 'offline') return empty ? copy.offlineEmpty : copy.offline
  if (!empty) return ''
  return state === 'onlyHidden' ? hiddenLine(hidden).text : nothingLine(words, filtered)
}

function hiddenLine(hidden: SearchResultsProps['hidden']) {
  const where = hidden.apps && hidden.automated ? 'apps and automated channels' : hidden.apps ? 'apps' : 'automated channels'
  const count = hidden.count === 1 ? '1 match' : `${hidden.count} matches`
  return { count, text: hidden.count === 1 ? `1 match, from ${where}.` : `${count}, all from ${where}.` }
}

function nothingLine(words: string, filtered: boolean): string {
  const quoted = words.trim() === '' ? 'Nothing matches.' : `Nothing matches “${words.trim()}”.`
  return `${quoted} ${filtered ? 'Try fewer words, or remove a filter.' : 'Try fewer or other words.'}`
}

function Results(props: SearchResultsProps & { readonly rows: ReadonlyArray<SearchRowItem> }) {
  const { rows, state, note, selectedId, focused, now, time, onSelect, onOpen, onExpand, onHoverRow, onTryAgain, onNearEnd, onNearStart, windowKey } = props
  const stops = rows.filter(isStop).map((row) => row.id)
  // The selection, or the first row when the selection is not among these rows: Tab always has a row to land on.
  const tabStop = selectedId !== undefined && stops.includes(selectedId) ? selectedId : stops[0]
  const end = useRef<HTMLDivElement>(null)
  const start = useRef<HTMLDivElement>(null)
  useNear(end, onNearEnd, '0px 0px 480px 0px', windowKey)
  useNear(start, onNearStart, '480px 0px 0px 0px', windowKey)
  const onListKey = useListKeys(props, stops)
  // The row last warmed, so moving within one row warms it once.
  const hovered = useRef<string | undefined>(undefined)
  const empty = rows.length === 0
  const banner = state === 'slackUnavailable' || (state === 'offline' && !empty)
  return (
    <>
      <div ref={start} {...stylex.props(styles.sentinel)} />
      {note === undefined ? null : <p data-sensitive="" data-search-note="" {...stylex.props(styles.quiet, styles.note)}>{note}</p>}
      {banner ? (
        <Notice text={state === 'offline' ? copy.offline : copy.unavailable}>
          {state === 'slackUnavailable' ? (
            <Button size="sm" iconStart={ArrowCounterClockwise} onClick={onTryAgain}>
              Try again
            </Button>
          ) : null}
        </Notice>
      ) : null}
      {empty ? (
        <EmptyNote {...props} />
      ) : (
        <div
          role="listbox"
          aria-label="Results"
          tabIndex={-1}
          onKeyDown={onListKey}
          onPointerOver={
            onHoverRow === undefined
              ? undefined
              : (event) => {
                  const id = (event.target as Element).closest<HTMLElement>('[data-search-row]')?.dataset.searchRow
                  if (id === undefined || id === hovered.current) return
                  hovered.current = id
                  onHoverRow(id)
                }
          }
          {...stylex.props(styles.list)}
        >
          {rows.map((row) => (
            <SearchRow key={row.id} row={row} now={now} time={time} selected={row.id === selectedId} focused={focused} tabbable={row.id === tabStop} onSelect={onSelect} onOpen={onOpen} onExpand={onExpand} />
          ))}
        </div>
      )}
      {state === 'searching' && !empty ? <p {...stylex.props(styles.quiet, styles.tail)}>{copy.searching}</p> : null}
      <div ref={end} {...stylex.props(styles.sentinel)} />
    </>
  )
}

/** The list's keys: the arrows, Enter, Tab, and a character typed, which goes to the field. */
function useListKeys({ rows, onSelect, onOpen, onExpand, onLeaveTop, onTab, onType }: SearchResultsProps & { readonly rows: ReadonlyArray<SearchRowItem> }, stops: ReadonlyArray<string>) {
  const move = (from: string, step: 1 | -1) => {
    const at = stops.indexOf(from)
    if (step === -1 && at <= 0) return onLeaveTop()
    const id = stops[Math.min(stops.length - 1, at + step)]
    if (id === undefined || id === from) return
    onSelect(id, 'keyboard')
    const row = document.getElementById(searchRowDomId(id))
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'nearest' })
  }
  return (event: KeyboardEvent<HTMLDivElement>) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-search-row]')?.dataset.searchRow
    if (id === undefined) return
    const item = rows.find((candidate) => candidate.id === id)
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && plain) {
      event.preventDefault()
      return move(id, event.key === 'ArrowDown' ? 1 : -1)
    }
    if (event.key === 'Enter' || (event.key === ' ' && item?.kind === 'more')) {
      event.preventDefault()
      return item?.kind === 'more' ? onExpand(item.group.id) : onOpen(id, { newTab: event.metaKey })
    }
    if (event.key === 'Tab' && !event.shiftKey && plain) {
      if (onTab()) event.preventDefault()
      return
    }
    if (plain && (event.key.length === 1 || event.key === 'Backspace') && event.key !== ' ') {
      event.preventDefault()
      onType(event.key)
    }
  }
}

/** Calls `onNear` while `target` is within `margin` of the scroller's view; again when `key` changes. */
function useNear(target: RefObject<HTMLDivElement | null>, onNear: (() => void) | undefined, margin: string, key: string | undefined) {
  const near = useEffectEvent(() => onNear?.())
  const enabled = onNear !== undefined
  useEffect(() => {
    const element = target.current
    if (element === null || !enabled) return
    const root = element.closest('[data-scroll-area]')
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) near()
    }, { root, rootMargin: margin })
    observer.observe(element)
    return () => observer.disconnect()
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- A new page key must re-check proximity with the same sentinel.
  }, [target, enabled, margin, key])
}

function Notice({ text: line, sensitive = false, children }: { readonly text: string; readonly sensitive?: boolean; readonly children?: ReactNode }) {
  return (
    <div {...stylex.props(styles.notice)}>
      <p data-sensitive={sensitive ? '' : undefined} {...stylex.props(styles.noticeText)}>{line}</p>
      {children === null || children === undefined ? null : <span {...stylex.props(styles.actions)}>{children}</span>}
    </div>
  )
}

function EmptyNote({ state, words, filtered, hidden, onClearFilters, onShowHidden }: SearchResultsProps) {
  if (state === 'pending') return null
  if (state === 'searching') return <p {...stylex.props(styles.quiet, styles.tail)}>{copy.searching}</p>
  if (state === 'offline') return <Notice text={copy.offlineEmpty} />
  if (state === 'onlyHidden') {
    const line = hiddenLine(hidden)
    return (
      <Notice text={line.text}>
        <Button size="sm" onClick={onShowHidden}>{`Show ${line.count}`}</Button>
      </Notice>
    )
  }
  return (
    <Notice sensitive={words.trim() !== ''} text={nothingLine(words, filtered)}>
      {filtered ? <Button size="sm" onClick={onClearFilters}>Clear filters</Button> : null}
    </Notice>
  )
}

const styles = stylex.create({
  scroller: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    scrollbarGutter: 'stable',
  },
  column: {
    paddingTop: spacing['--space-2'],
    paddingBottom: spacing['--space-3'],
    paddingInline: spacing['--space-3'],
  },
  sentinel: {
    height: 0,
  },
  live: {
    position: 'absolute',
    width: '1px', // tokens-allow: the visually hidden pattern
    height: '1px', // tokens-allow: the visually hidden pattern
    margin: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    outlineStyle: 'none',
  },
  quiet: {
    margin: 0,
    fontSize: text['--text-meta-size'],
    color: colors['--foreground-muted'],
  },
  note: {
    paddingInline: spacing['--space-2-5'],
    paddingBlock: spacing['--space-1-5'],
  },
  tail: {
    display: 'flex',
    alignItems: 'center',
    height: sizes['--control-36'],
    paddingInline: spacing['--space-2-5'],
  },
  notice: {
    paddingTop: spacing['--space-2-5'],
    paddingBottom: spacing['--space-3'],
    paddingInline: spacing['--space-2-5'],
  },
  noticeText: {
    margin: 0,
    fontSize: text['--text-meta-size'],
    lineHeight: text['--text-ui-leading'],
    color: colors['--foreground-subtle'],
  },
  actions: {
    display: 'flex',
    gap: spacing['--space-1-5'],
    marginTop: spacing['--space-2'],
  },
})

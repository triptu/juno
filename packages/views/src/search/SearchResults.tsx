/**
 * The Search tab's results (SPEC 10a, inventory 9a): the cards of
 * `searchRows`, the states, and on an empty field the recent searches.
 * Dumb: the owner keeps the selection, the panel and runs what is chosen.
 *
 * - A press on a card selects it and shows its topic beside the list;
 *   ⌘-press opens it in a tab behind this one and the selection stays.
 * - ↑ and ↓ move the selection and focus with it (the panel, when open,
 *   follows); ↑ on the first card goes back to the field. Space shows or
 *   hides the topic, → shows it, Esc hides it. Enter opens the card's
 *   topic, ⌘Enter in a tab behind. Tab goes on to the panel's composer
 *   when there is one. A character typed goes to the field.
 * - The matched words are marked in every card (`useCardMarks`).
 * - Rows are in flow with `content-visibility: auto`. The owner moves the
 *   engine's window when the list nears either end.
 */
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useEffectEvent, useRef, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react'
import type { SearchSnapshot } from '@juno/contract'
import { colors, layout, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Button, type ActivateEvent } from '@juno/ui'
import type { LinkInfo } from '../MessageLink'
import { useCardMarks } from './marks'
import { isStop, type SearchRowItem } from './rows'
import { SearchRecent, type SearchRecentProps } from './SearchRecent'
import { SearchRow, searchRowDomId, type SearchTimeLeaf } from './SearchRow'

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
  /** The list or the field has focus: the selected card takes the accent edge. */
  readonly focused: boolean
  /** The query's words, marked in the cards. */
  readonly marks: ReadonlyArray<string>
  readonly now?: number
  readonly time?: SearchTimeLeaf
  readonly listRef?: Ref<HTMLDivElement>
  /** A card chosen by the arrows or by focus. */
  readonly onSelect: (id: string, how: 'pointer' | 'keyboard') => void
  /** A press on a card: select it and show its topic. */
  readonly onPress: (id: string) => void
  readonly onOpen: (id: string, options: { readonly newTab: boolean }) => void
  /** Space on a card: show its topic beside the list, or hide it. */
  readonly onToggleTopic: (id: string) => void
  /** → on a card: show its topic. */
  readonly onShowTopic: (id: string) => void
  /** Esc in the list: hide the topic. False when there was none to hide. */
  readonly onHideTopic: () => boolean
  readonly onLink?: ((url: string, event: ActivateEvent) => void) | undefined
  readonly linkInfo?: LinkInfo | undefined
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
  const { rows, state, note, selectedId, focused, marks, now, time, onSelect, onPress, onOpen, onLink, linkInfo, onHoverRow, onTryAgain, onNearEnd, onNearStart, windowKey } = props
  const stops = rows.filter(isStop).map((row) => row.id)
  // The selection, or the first row when the selection is not among these rows: Tab always has a row to land on.
  const tabStop = selectedId !== undefined && stops.includes(selectedId) ? selectedId : stops[0]
  const end = useRef<HTMLDivElement>(null)
  const start = useRef<HTMLDivElement>(null)
  useNear(end, onNearEnd, '0px 0px 480px 0px', windowKey)
  useNear(start, onNearStart, '480px 0px 0px 0px', windowKey)
  const onListKey = useListKeys(props, stops)
  const list = useRef<HTMLDivElement>(null)
  useCardMarks(list, marks)
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
          ref={list}
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
            <SearchRow key={row.id} row={row} now={now} time={time} words={marks} selected={row.id === selectedId} focused={focused} tabbable={row.id === tabStop} onSelect={onSelect} onPress={onPress} onOpen={onOpen} onLink={onLink} linkInfo={linkInfo} />
          ))}
        </div>
      )}
      {state === 'searching' && !empty ? <p {...stylex.props(styles.quiet, styles.tail)}>{copy.searching}</p> : null}
      <div ref={end} {...stylex.props(styles.sentinel)} />
    </>
  )
}

/** The list's keys: the arrows, Space, → and Esc for the topic beside it, Enter, Tab, and a character typed, which goes to the field. */
function useListKeys({ onSelect, onOpen, onToggleTopic, onShowTopic, onHideTopic, onLeaveTop, onTab, onType }: SearchResultsProps, stops: ReadonlyArray<string>) {
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
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey
    // Enter and Space on a control inside a card, such as Show more, are the control's.
    const control = (event.target as HTMLElement).matches('a, button')
    if (control && plain && (event.key === 'Enter' || event.key === ' ')) return
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && plain) {
      event.preventDefault()
      return move(id, event.key === 'ArrowDown' ? 1 : -1)
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      return onOpen(id, { newTab: event.metaKey })
    }
    if (event.key === ' ' && plain && !event.shiftKey) {
      event.preventDefault()
      return onToggleTopic(id)
    }
    if (event.key === 'ArrowRight' && plain) {
      event.preventDefault()
      return onShowTopic(id)
    }
    if (event.key === 'Escape' && plain) {
      if (onHideTopic()) event.preventDefault()
      return
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
  // The cards at most --search-measure wide, in the middle of the results.
  column: {
    boxSizing: 'content-box',
    maxWidth: layout['--search-measure'],
    marginInline: 'auto',
    paddingTop: spacing['--space-1'],
    paddingBottom: spacing['--space-4'],
    paddingInline: spacing['--space-4'],
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

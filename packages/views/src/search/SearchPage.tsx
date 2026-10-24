/**
 * The Search tab's page (SPEC 10a, inventory 9a): the field and the filter
 * row across the tab, then the split: the results column (384px, 312 to
 * 480 by its edge, double-click for the default) and the reader, the topic
 * itself. Under 792px (the column's minimum and the reader's 480) it is
 * one column: the list, or the reader once the owner shows it.
 */
import * as stylex from '@stylexjs/stylex'
import { useEffect, useEffectEvent, useRef, type FocusEvent, type ReactNode, type Ref } from 'react'
import { TOPIC_MIN_WIDTH } from '@juno/tokens/layout'
import { SEARCH_COLUMN_WIDTH } from '@juno/contract'
import { colors, spacing, z } from '@juno/tokens/tokens.stylex'
import { useNarrowerThan } from '@juno/ui'
import { ResizeEdge } from '../ResizeEdge'

/** The column's minimum and the reader's: under their sum the page is one column. */
const ONE_COLUMN_BELOW = SEARCH_COLUMN_WIDTH.min + TOPIC_MIN_WIDTH

export interface SearchPageProps {
  /** The `SearchField`. */
  readonly field: ReactNode
  /** The `SearchFilters`. */
  readonly filters: ReactNode
  /** The `SearchResults`. */
  readonly results: ReactNode
  /** The topic the selection shows; nothing until a result is chosen. */
  readonly reader: ReactNode
  /** The reader's box, where the owner marks the matched words. */
  readonly readerRef?: Ref<HTMLDivElement>
  /** One column: the reader shows in place of the list. */
  readonly readerShown: boolean
  readonly columnWidth: number
  readonly onResizeColumn: (width: number) => void
  readonly onResetColumn: () => void
  /** The page became one column, or two. */
  readonly onNarrow?: (narrow: boolean) => void
  /** Focus came into the field or the list, or left both: the selected row's tint follows. */
  readonly onListFocus?: (focused: boolean) => void
}

export function SearchPage({ field, filters, results, reader, readerRef, readerShown, columnWidth, onResizeColumn, onResetColumn, onNarrow, onListFocus }: SearchPageProps) {
  const root = useRef<HTMLDivElement>(null)
  const narrow = useNarrowerThan(root, ONE_COLUMN_BELOW)
  const reportNarrow = useEffectEvent((value: boolean) => onNarrow?.(value))
  useEffect(() => reportNarrow(narrow), [narrow])

  // The field and the list count as one place for focus, as ⌘K's field and rows do. The column's resize edge does not.
  const isEdge = (target: EventTarget | null) => target instanceof Element && target.matches('[data-resize-edge]')
  const listFocus = {
    onFocus: (event: FocusEvent<HTMLElement>) => onListFocus?.(!isEdge(event.target)),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget
      const inside = (selector: string) => next instanceof Node && root.current?.querySelector(selector)?.contains(next) === true
      if (isEdge(next) || (!inside('[data-search-band]') && !inside('[data-search-column]'))) onListFocus?.(false)
    },
  }

  return (
    <div ref={root} data-search-page="" {...stylex.props(styles.page)}>
      <div data-search-band="" {...listFocus} {...stylex.props(styles.band)}>
        {field}
        {filters}
      </div>
      <div {...stylex.props(styles.split)}>
        <div data-search-column="" {...listFocus} {...stylex.props(styles.column, widthOf(columnWidth), narrow && (readerShown ? styles.gone : styles.whole))}>
          {results}
          {narrow ? null : <ResizeEdge width={columnWidth} min={SEARCH_COLUMN_WIDTH.min} max={SEARCH_COLUMN_WIDTH.max} label="Resize results" onResize={onResizeColumn} onReset={onResetColumn} />}
        </div>
        <div ref={readerRef} data-search-reader="" {...stylex.props(styles.reader, narrow && !readerShown && styles.gone)}>
          {reader}
        </div>
      </div>
    </div>
  )
}

const widthOf = stylex.create({
  at: (width: number) => ({ width }),
}).at

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minWidth: 0,
    backgroundColor: colors['--background'],
  },
  // The field and the filters across the tab, over the split; over the reader's header islands too, so the picker hangs over them.
  // A size container, so the filter row can wrap its toggles.
  band: {
    position: 'relative',
    zIndex: z['--z-picker'],
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-3'],
    borderBottomWidth: spacing['--space-pixel'],
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
    containerName: 'search-band',
    containerType: 'inline-size',
  },
  split: {
    flexGrow: 1,
    minHeight: 0,
    display: 'flex',
  },
  column: {
    position: 'relative',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    borderInlineEndWidth: spacing['--space-pixel'],
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: colors['--border-default'],
  },
  // One column: the list takes the page's width and its rows end in an ellipsis, down to the smallest window.
  whole: {
    width: 'auto',
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    borderInlineEndWidth: 0,
  },
  gone: {
    display: 'none',
  },
  reader: {
    position: 'relative',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
})

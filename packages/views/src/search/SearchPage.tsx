/**
 * The Search tab's page (SPEC 10a, inventory 9a): the results first, the
 * field and the filter row over them, all at most `--search-measure` wide
 * in the middle of the page. The selected card's topic shows in a panel on
 * the right once asked for (`panelShown`), 560px by default and resizable
 * from 480 to 800 by its left edge; the results keep at least
 * `--search-list-min`. Under that plus a topic's minimum the panel covers
 * the results, with Back to results in its header.
 */
import * as stylex from '@stylexjs/stylex'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, type FocusEvent, type ReactNode, type Ref } from 'react'
import { SEARCH_LIST_MIN_WIDTH, TOPIC_MIN_WIDTH } from '@juno/tokens/layout'
import { SEARCH_PANEL_WIDTH } from '@juno/contract'
import { colors, layout, spacing, z } from '@juno/tokens/tokens.stylex'
import { useNarrowerThan } from '@juno/ui'
import { ResizeEdge } from '../ResizeEdge'

/** Under the results' minimum and a topic's, the panel covers the results. */
const COVER_BELOW = SEARCH_LIST_MIN_WIDTH + TOPIC_MIN_WIDTH

export interface SearchPageProps {
  /** The `SearchField`. */
  readonly field: ReactNode
  /** The `SearchFilters`. */
  readonly filters: ReactNode
  /** The `SearchResults`. */
  readonly results: ReactNode
  /** The selected card's topic. */
  readonly reader: ReactNode
  /** The panel's box, where the owner marks the matched words. */
  readonly readerRef?: Ref<HTMLDivElement>
  /** The topic shows beside the results, or over them in a narrow page. */
  readonly panelShown: boolean
  readonly panelWidth: number
  readonly onResizePanel: (width: number) => void
  readonly onResetPanel: () => void
  /** The panel now covers the results, or sits beside them. */
  readonly onNarrow?: (narrow: boolean) => void
  /** Focus came into the field or the results, or left both: the selected card's accent edge follows. */
  readonly onListFocus?: (focused: boolean) => void
}

export function SearchPage({ field, filters, results, reader, readerRef, panelShown, panelWidth, onResizePanel, onResetPanel, onNarrow, onListFocus }: SearchPageProps) {
  const root = useRef<HTMLDivElement>(null)
  const narrow = useNarrowerThan(root, COVER_BELOW)
  const reportNarrow = useEffectEvent((value: boolean) => onNarrow?.(value))
  useEffect(() => reportNarrow(narrow), [narrow])
  // The panel's width is written on the box, as the sidebar's is (Shell), so it follows the preference after its edge wrote a width straight onto it.
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (panelShown && panel.current !== null) panel.current.style.width = narrow ? '' : `${panelWidth}px`
  }, [narrow, panelWidth, panelShown])

  // The field and the results count as one place for focus, as ⌘K's field and rows do.
  const listFocus = {
    onFocus: () => onListFocus?.(true),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget
      if (!(next instanceof Node && root.current?.querySelector('[data-search-main]')?.contains(next) === true)) onListFocus?.(false)
    },
  }

  return (
    <div ref={root} data-search-page="" {...stylex.props(styles.page)}>
      <div data-search-main="" {...listFocus} {...stylex.props(styles.main, panelShown && narrow && styles.gone)}>
        <div data-search-band="" {...stylex.props(styles.band)}>
          <div {...stylex.props(styles.measure)}>
            {field}
            {filters}
          </div>
        </div>
        <div data-search-column="" {...stylex.props(styles.column)}>
          {results}
        </div>
      </div>
      {panelShown ? (
        <div ref={panel} data-search-panel="" {...stylex.props(styles.panel, narrow && styles.cover)}>
          {narrow ? null : <ResizeEdge side="start" width={panelWidth} min={SEARCH_PANEL_WIDTH.min} max={SEARCH_PANEL_WIDTH.max} label="Resize topic" onResize={onResizePanel} onReset={onResetPanel} />}
          <div ref={readerRef} data-search-reader="" {...stylex.props(styles.reader)}>
            {reader}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const styles = stylex.create({
  page: {
    position: 'relative',
    display: 'flex',
    height: '100%',
    minWidth: 0,
    backgroundColor: colors['--background'],
  },
  main: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: layout['--search-list-min'],
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  // The field and the filters over the results, over the picker's layer so the picker hangs over the cards.
  // A size container, so the filter row can wrap its toggles.
  band: {
    position: 'relative',
    zIndex: z['--z-picker'],
    flexShrink: 0,
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-4'],
    borderBottomWidth: spacing['--space-pixel'],
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
    containerName: 'search-band',
    containerType: 'inline-size',
  },
  measure: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    maxWidth: layout['--search-measure'],
    marginInline: 'auto',
  },
  column: {
    position: 'relative',
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  gone: {
    display: 'none',
  },
  // Beside the results: it gives way down to a topic's minimum before the results go under theirs.
  panel: {
    position: 'relative',
    flexShrink: 1,
    minWidth: 0,
    display: 'flex',
    borderInlineStartWidth: spacing['--space-pixel'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colors['--border-default'],
    backgroundColor: colors['--background'],
  },
  // A narrow page: over the results, the whole page.
  cover: {
    position: 'absolute',
    inset: 0,
    width: 'auto',
    borderInlineStartWidth: 0,
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

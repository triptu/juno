import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { layout, sizes, spacing, z } from '@juno/tokens/tokens.stylex'
import { HeaderBand, Surface } from '@juno/ui'

/**
 * Which column the islands line up with: the topic's 800px reading column,
 * the Juno tab's 720px chat column, or the full width of the Juno panel.
 */
export type HeaderColumn = 'reading' | 'page' | 'panel'

export interface HeaderIslandsProps {
  readonly column: HeaderColumn
  /** The left island: the context pill and the title button, or the Juno title button. */
  readonly left: ReactNode
  /** The right island's buttons. No right island when absent. */
  readonly right?: ReactNode
  /** Extra attributes for tests and probes (`data-topic-header`). */
  readonly data?: Readonly<Record<`data-${string}`, string>>
}

/**
 * A page header with no bar (SPEC 7, inventory 5): two solid islands on a
 * band of the page colour, over the top of the area. The owner's area is
 * `position: relative` and its list runs under this layer
 * (`ScrollArea underHeader`). Nothing here takes part in the list's
 * layout, so a header change never moves the list. The layer is a size
 * container, so the buttons can switch to their narrow form by the area's
 * width alone.
 */
export function HeaderIslands({ column, left, right, data }: HeaderIslandsProps) {
  return (
    <header {...data} {...stylex.props(styles.root)}>
      <HeaderBand />
      <div {...stylex.props(styles.row, columns[column])}>
        <Surface kind="island" data-island="left" sx={styles.left}>
          {left}
        </Surface>
        {right === undefined ? null : (
          <Surface kind="island" data-island="right" sx={styles.right}>
            {right}
          </Surface>
        )}
      </div>
    </header>
  )
}

const styles = stylex.create({
  // Out of flow and transparent to the pointer; only the islands take it.
  root: {
    position: 'absolute',
    top: 0,
    insetInline: 0,
    height: layout['--header-band'],
    zIndex: z['--z-header'],
    pointerEvents: 'none',
    containerType: 'inline-size',
    userSelect: 'none',
  },
  row: {
    position: 'absolute',
    top: layout['--header-island-top'],
    insetInline: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-2'],
    marginInline: 'auto',
    boxSizing: 'border-box',
    pointerEvents: 'none',
  },
  // The pill sits 2px further in than the island's even inset, so its
  // round end clears the island's.
  left: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    paddingInlineStart: `calc((${layout['--header-island-height']} - ${sizes['--control-28']}) / 2 - 1px + ${spacing['--space-0-5']})`,
  },
  right: {
    flexShrink: 0,
  },
})

// The islands' outer edges line up with the column's: the composer's edges in a topic, the chat's in the Juno tab.
const columns = stylex.create({
  reading: { maxWidth: layout['--reading-width'], paddingInline: spacing['--space-6'] },
  page: { maxWidth: layout['--page-width'], paddingInline: spacing['--space-8'] },
  panel: { paddingInline: spacing['--space-3'] },
})

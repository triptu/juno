import * as stylex from '@stylexjs/stylex'
import { Quotes } from '@phosphor-icons/react/dist/icons/Quotes'
import type { ReactNode } from 'react'
import { spacing, z } from '@juno/tokens/tokens.stylex'
import { Button } from '@juno/ui'

/**
 * Where a floating element sits, in CSS pixels from the top left of the
 * topic's message area (`TopicView`'s `floating` slot), which the container
 * measured.
 *
 * - `below-end`: under `y`, its right edge at `x` (the emoji picker under
 *   the toolbar's More reactions button).
 * - `above-end`: over `y`, its right edge at `x` (the picker near the
 *   bottom of the list).
 * - `above-center`: centred on `x`, its bottom `--space-2` over `y` (the
 *   selection's Quote button).
 */
export type FloatingPlacement = 'below-end' | 'above-end' | 'above-center'

export interface FloatingProps {
  readonly x: number
  readonly y: number
  readonly placement: FloatingPlacement
  readonly layer: 'picker' | 'selection'
  readonly children: ReactNode
}

/**
 * Floats a panel or a button over the message list, outside the rows,
 * whose paint containment would clip it. The container measures once and
 * passes the point; nothing here reads layout.
 */
export function Floating({ x, y, placement, layer, children }: FloatingProps) {
  return (
    <div data-floating={layer} {...stylex.props(styles.base, layer === 'picker' ? styles.picker : styles.selection, styles.at(x, y), placements[placement])}>
      {children}
    </div>
  )
}

export interface SelectionQuoteProps {
  /** Quotes the selected text. Runs on mouse down, so the selection is still there. */
  readonly onQuote: () => void
}

/** The floating Quote button over a text selection in a message (inventory 6.6). */
export function SelectionQuote({ onQuote }: SelectionQuoteProps) {
  return (
    <Button
      variant="raised"
      size="sm"
      iconStart={Quotes}
      data-selection-quote=""
      onMouseDown={(event) => {
        // Keep the selection: the quote is taken from it.
        event.preventDefault()
        if (event.button === 0) onQuote()
      }}
      onClick={(event) => {
        // A keyboard activation has no mouse down.
        if (event.detail === 0) onQuote()
      }}
    >
      Quote
    </Button>
  )
}

const styles = stylex.create({
  base: {
    position: 'absolute',
    display: 'inline-flex',
  },
  picker: {
    zIndex: z['--z-picker'],
  },
  selection: {
    zIndex: z['--z-selection'],
  },
  at: (x: number, y: number) => ({
    left: `${x}px`,
    top: `${y}px`,
  }),
})

const placements = stylex.create({
  'below-end': {
    translate: `-100% ${spacing['--space-1']}`,
  },
  'above-end': {
    translate: `-100% calc(-100% - ${spacing['--space-1']})`,
  },
  'above-center': {
    translate: `-50% calc(-100% - ${spacing['--space-2']})`,
  },
})

import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { spacing, z } from '@juno/tokens/tokens.stylex'

/**
 * Where a floating element sits, in CSS pixels from the top left of the
 * list area (`TopicView`'s and `JunoChatFrame`'s `floating` slot), which the
 * container measured.
 *
 * - `below-end`: under `y`, its right edge at `x` (the emoji picker under
 *   the toolbar's More reactions button, the Juno chat's reactions under React).
 * - `above-end`: over `y`, its right edge at `x` (the picker near the
 *   bottom of the list).
 * - `above-center`: centred on `x`, its bottom `--space-2` over `y` (the
 *   selection's toolbar).
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
 * passes the point; nothing here reads layout. The point is rounded to whole
 * pixels: a selection's edges rarely are, and the icons inside would then
 * draw off their buttons' centres.
 */
export function Floating({ x, y, placement, layer, children }: FloatingProps) {
  return (
    <div data-floating={layer} {...stylex.props(styles.base, layer === 'picker' ? styles.picker : styles.selection, styles.at(Math.round(x), Math.round(y)), placements[placement])}>
      {children}
    </div>
  )
}

const styles = stylex.create({
  base: {
    position: 'absolute',
    display: 'inline-flex',
    // Over a title bar's drag strip near the top of the page, which would otherwise take the press.
    WebkitAppRegion: 'no-drag',
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

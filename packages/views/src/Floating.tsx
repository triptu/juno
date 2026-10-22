import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { spacing, z } from '@juno/tokens/tokens.stylex'

export interface FloatingProps {
  /** The point the bar is centred over, in CSS pixels from the top left of the list area. */
  readonly x: number
  readonly y: number
  readonly children: ReactNode
}

/**
 * Floats the selection's bar over the message list (`TopicView`'s
 * `floating` slot), outside the rows, whose paint containment would clip
 * it: centred on `x`, its bottom `--space-2` over `y`. The container
 * measures once and passes the point; nothing here reads layout. The point
 * is rounded to whole pixels: a selection's edges rarely are, and the icons
 * inside would then draw off their buttons' centres.
 */
export function Floating({ x, y, children }: FloatingProps) {
  return (
    <div data-floating="selection" {...stylex.props(styles.base, styles.at(Math.round(x), Math.round(y)))}>
      {children}
    </div>
  )
}

const styles = stylex.create({
  base: {
    position: 'absolute',
    display: 'inline-flex',
    zIndex: z['--z-selection'],
    translate: `-50% calc(-100% - ${spacing['--space-2']})`,
    // Over a title bar's drag strip near the top of the page, which would otherwise take the press.
    WebkitAppRegion: 'no-drag',
  },
  at: (x: number, y: number) => ({
    left: `${x}px`,
    top: `${y}px`,
  }),
})

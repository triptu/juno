import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { HomeItem } from '@juno/contract'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Home } from '../Home'
import { NOW } from './topics'

const noop = () => {}

/** Home with `items` under a sheet's layer, as the window shows a review: the layer dims the page and the sheet sits in the middle. */
export function OverHome({ items, children }: { readonly items: ReadonlyArray<HomeItem>; readonly children: ReactNode }) {
  return (
    <div {...stylex.props(styles.window)}>
      <Home scene="evening" title="Evening, Tushar." items={items} now={NOW} enter={false} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onReview={noop} onSort={noop} onItemMenu={noop} />
      <div {...stylex.props(styles.layer)}>{children}</div>
    </div>
  )
}

const styles = stylex.create({
  // The frame's size: its first child fills it.
  window: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '720px', // tokens-allow: the fixture frame's height
    overflow: 'hidden',
    backgroundColor: colors['--background'],
  },
  // The `SheetLayer` look, inside the frame instead of the whole window.
  layer: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['--space-6'],
    backgroundColor: colors['--overlay'],
  },
})

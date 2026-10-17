/** The frames the review sheets' fixtures draw in: the window, and a sheet over Home in it. */
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, spacing } from '@juno/tokens/tokens.stylex'

/** The fixture frame's size: its first child fills it. */
function FixtureWindow({ children }: { readonly children: ReactNode }) {
  return <div {...stylex.props(styles.window)}>{children}</div>
}

/** Home under the sheet's layer, as the window shows it: the layer dims the page and the sheet sits in the middle. */
export function OverHome({ home, children }: { readonly home: ReactNode; readonly children: ReactNode }) {
  return (
    <FixtureWindow>
      {home}
      <div {...stylex.props(styles.layer)}>{children}</div>
    </FixtureWindow>
  )
}

const styles = stylex.create({
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

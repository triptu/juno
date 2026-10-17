import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { chat, colors } from '@juno/tokens/tokens.stylex'
import { PageUnderHeader } from '@juno/ui'

export interface JunoPageFrameProps {
  /** `JunoHeader` with the page as `current`, in the same place as over the chat. */
  readonly header: ReactNode
  /** The page: `ActivityPage`, `ScheduledPage` and the rest. */
  readonly children: ReactNode
  /** `panel`: drawn on the Juno panel's own material, with no page colour. Default `page`. */
  readonly column?: 'page' | 'panel'
}

/**
 * A Juno page as the Juno tab and the Juno panel show it (SPEC 13.10): the
 * Juno header's islands over the page, as over the chat, so the switcher is
 * in the same place on every Juno view. The page scrolls under the band.
 */
export function JunoPageFrame({ header, children, column = 'page' }: JunoPageFrameProps) {
  return (
    <div data-juno-page="" {...stylex.props(styles.root, column === 'panel' && styles.panel)}>
      {header}
      <PageUnderHeader value>{children}</PageUnderHeader>
    </div>
  )
}

const styles = stylex.create({
  root: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors['--background'],
    // What a sticky label on the page fills with, so rows pass under it.
    '--juno-page-fill': colors['--background'],
  },
  panel: {
    backgroundColor: 'transparent',
    '--juno-page-fill': chat['--panel-fill'],
  },
})

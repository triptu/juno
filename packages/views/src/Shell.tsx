import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'

export interface ShellProps {
  /** The left pane. Without one (signed out) the page fills the window under a drag strip. */
  readonly sidebar?: ReactNode
  readonly children?: ReactNode
}

/**
 * The window frame (spec section 4). Signed in: the sidebar on the left and
 * the workspace on the right, each with its own 44px drag bar. Signed out:
 * one drag strip over a page. It paints with no data; everything that
 * waits on the engine renders its own waiting state inside. Nothing above
 * the panes may change on a tick (performance 4.3).
 */
export function Shell({ sidebar, children }: ShellProps) {
  if (sidebar !== undefined) {
    return (
      <div {...stylex.props(styles.shell, styles.panes)}>
        {sidebar}
        {children}
      </div>
    )
  }
  return (
    <div {...stylex.props(styles.shell, styles.column)}>
      <header {...stylex.props(styles.titlebar)} aria-label="Window title bar" />
      <main {...stylex.props(styles.page)}>{children}</main>
    </div>
  )
}

const styles = stylex.create({
  shell: {
    display: 'flex',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: colors['--background'],
    color: colors['--foreground-default'],
  },
  panes: {
    flexDirection: 'row',
  },
  column: {
    flexDirection: 'column',
  },
  titlebar: {
    flexShrink: 0,
    height: layout['--titlebar-height'],
    // The strip is draggable; interactive children must set no-drag.
    WebkitAppRegion: 'drag',
    userSelect: 'none',
  },
  page: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-4'],
    paddingInline: spacing['--space-8'],
    paddingBlock: spacing['--space-4'],
    backgroundColor: colors['--background'],
  },
})

import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'

export interface ShellProps {
  readonly children?: ReactNode
}

/**
 * The window frame: a draggable title bar over a page. It paints with no
 * data; everything that waits on the engine renders its own waiting state
 * inside. Tabs will live inside `<main>` as `<Activity>` children
 * (performance 4.3); nothing above them may change on a tick.
 */
export function Shell({ children }: ShellProps) {
  return (
    <div {...stylex.props(styles.shell)}>
      <header {...stylex.props(styles.titlebar)} aria-label="Window title bar" />
      <main {...stylex.props(styles.page)}>{children}</main>
    </div>
  )
}

const styles = stylex.create({
  shell: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: colors['--background'],
    color: colors['--foreground-default'],
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

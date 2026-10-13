import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors } from '@juno/tokens/tokens.stylex'
import { EmptyState, TabStrip } from '@juno/ui'

export interface WorkspaceProps {
  /** The open page. Nothing open shows the empty state. */
  readonly children?: ReactNode
}

/**
 * The right pane: the tab strip (a window drag region) over the page.
 * Tabs arrive in M4; until then the strip is empty and the page says so.
 */
export function Workspace({ children }: WorkspaceProps) {
  return (
    <section aria-label="Workspace" {...stylex.props(styles.root)}>
      <TabStrip />
      <main {...stylex.props(styles.page)}>
        {children ?? <EmptyState variant="workspace" illustration="nothing-open" title="Nothing open yet" body="Pick a topic on the left, or press ⌘K." padding="page" />}
      </main>
    </section>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
    height: '100%',
    backgroundColor: colors['--background'],
  },
  page: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    minHeight: 0,
    backgroundColor: colors['--background'],
  },
})

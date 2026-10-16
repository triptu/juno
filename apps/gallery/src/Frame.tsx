import * as stylex from '@stylexjs/stylex'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import type { ComponentEntry, StateEntry } from './registry'

/**
 * The one place the gallery uses product styling: the surface a state is
 * drawn on. Everything around it is plain gallery chrome (gallery.css).
 */
export function Stage({ children }: { readonly children: React.ReactNode }) {
  return <div {...stylex.props(styles.stage)}>{children}</div>
}

export function Frame({ entry, state }: { readonly entry: ComponentEntry; readonly state: StateEntry }) {
  const { frame, fixture } = state
  const Component = entry.set.component
  return (
    <div
      // The route, so the test runners can wait for this state's frame.
      data-fixture-frame={state.route}
      // A tooltip stays inside the frame, as it stays inside the window in the app.
      data-tooltip-bounds=""
      {...stylex.props(
        styles.frame,
        frame.padded !== false && styles.framePadded,
        surfaces[frame.surface ?? 'background'],
        frame.width !== undefined && styles.frameWidth(frame.width),
        frame.height !== undefined && styles.frameHeight(frame.height),
      )}
    >
      {fixture.render ? fixture.render() : <Component {...fixture.props} />}
    </div>
  )
}

const styles = stylex.create({
  stage: {
    flexGrow: 1,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    minWidth: 0,
    minHeight: 0,
    overflow: 'auto',
    padding: spacing['--space-6'],
    backgroundColor: colors['--background'],
  },
  frame: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    position: 'relative',
    boxSizing: 'border-box',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  framePadded: {
    padding: spacing['--space-6'],
  },
  frameWidth: (px: number) => ({ width: px }),
  frameHeight: (px: number) => ({ height: px }),
})

const surfaces = stylex.create({
  background: { backgroundColor: colors['--background'] },
  subtle: { backgroundColor: colors['--background-subtle'] },
  surface: { backgroundColor: colors['--surface-default'] },
  raised: { backgroundColor: colors['--surface-raised'] },
})

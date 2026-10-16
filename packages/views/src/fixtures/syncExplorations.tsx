/**
 * Directions A and B for the first sync's progress, drawn for the design
 * review only (docs/design/reviews/2026-10-17-sync-indicator). Direction C
 * is the shipped `SyncProgress` and `EngineNotice`.
 */
import * as stylex from '@stylexjs/stylex'
import { WifiSlash } from '@phosphor-icons/react/dist/icons/WifiSlash'
import { colors, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Icon, Popover, ProgressRing, Text } from '@juno/ui'

const noop = () => {}

export interface ActivityProps {
  readonly done: number
  readonly total: number
  readonly open?: boolean
  readonly offline?: boolean
}

/** A. The title bar's activity button: a ring before Search, and a popover on hover or click. */
export function Activity({ done, total, open = false, offline = false }: ActivityProps) {
  const line = `${done} of ${total} conversations`
  return (
    <Popover
      open={open}
      onClose={noop}
      placement="bottom-end"
      width="menu"
      padding="md"
      label="Sync"
      anchor={
        <button type="button" aria-label={offline ? "You're offline" : 'Syncing with Slack'} aria-expanded={open} {...stylex.props(styles.button, open && styles.open)}>
          {offline ? <Icon icon={WifiSlash} size={16} /> : <ProgressRing size={16} label="Sync progress" value={done} max={total} valueText={line} />}
        </button>
      }
    >
      <div {...stylex.props(styles.panel)}>
        <Text variant="ui" weight="medium" tone="default">
          {offline ? "You're offline" : 'Syncing with Slack'}
        </Text>
        <Text variant="meta" tone="subtle" numeric>
          {offline ? "Juno shows what it has and catches up when you're back." : line}
        </Text>
        {offline ? null : (
          <Text variant="meta" tone="muted">
            Topics show up in the sidebar as they arrive. Older history follows.
          </Text>
        )}
      </div>
    </Popover>
  )
}

/** B. The held list's empty state carries the ring and the count. */
export function EmptyProgress({ done, total }: { readonly done: number; readonly total: number }) {
  return (
    <div {...stylex.props(styles.empty)}>
      <ProgressRing label="Sync progress" value={done} max={total} valueText={`${done} of ${total} conversations`} />
      <Text variant="body" weight="medium" tone="default" as="h2">
        Getting your topics
      </Text>
      <Text variant="ui" tone="muted" as="p" sx={styles.emptyBody}>
        Juno has read {done} of {total} conversations. Topics show up here as they arrive.
      </Text>
    </div>
  )
}

/** B, once rows have landed: a quiet line after the last row. */
export function TrailingProgress({ done, total }: { readonly done: number; readonly total: number }) {
  return (
    <div role="listitem" {...stylex.props(styles.trailing)}>
      <ProgressRing size={16} label="Sync progress" value={done} max={total} valueText={`${done} of ${total} conversations`} />
      <Text variant="meta" tone="muted" numeric>
        Getting more topics, {done} of {total}
      </Text>
    </div>
  )
}

const styles = stylex.create({
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--control-30'],
    height: sizes['--control-30'],
    padding: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-lg'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, '@media (hover: hover)': colors['--surface-hover'] },
    },
    color: colors['--foreground-subtle'],
    cursor: 'default',
    transitionProperty: 'background-color',
    transitionDuration: motion['--duration-fast'],
  },
  open: { backgroundColor: colors['--surface-hover'] },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing['--space-2'],
    paddingBlock: spacing['--space-12'],
    paddingInline: spacing['--space-4'],
    textAlign: 'center',
  },
  emptyBody: { maxWidth: '100%' },
  trailing: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing['--space-2'],
    paddingBlock: spacing['--space-4'],
  },
})

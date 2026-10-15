import * as stylex from '@stylexjs/stylex'
import { HourglassMedium } from '@phosphor-icons/react/dist/icons/HourglassMedium'
import { WarningCircle } from '@phosphor-icons/react/dist/icons/WarningCircle'
import { WifiSlash } from '@phosphor-icons/react/dist/icons/WifiSlash'
import { colors, motion, spacing, text } from '@juno/tokens/tokens.stylex'
import { Button, Icon, Text, type PhosphorIcon } from '@juno/ui'

export interface EngineStatusViewProps {
  /** One short line, for example "Engine live". */
  readonly line: string
  /** The last answer to a ping, if any. */
  readonly pong?: string
  /** A sync cycle is running, so the line may change again soon. Read by assistive tech and tests, not shown. */
  readonly busy?: boolean
  readonly onPing: () => void
}

/** The engine's phase as a status line, with a ping button for diagnostics. */
export function EngineStatusView({ line, pong, busy = false, onPing }: EngineStatusViewProps) {
  return (
    <section {...stylex.props(styles.section)} aria-label="Engine">
      <Text variant="meta" tone="muted" numeric as="p" role="status" aria-label="Engine status" aria-busy={busy}>
        {line}
      </Text>
      <div {...stylex.props(styles.row)}>
        <Button onClick={onPing}>Ping engine</Button>
        {pong ? (
          <Text variant="meta" tone="muted" numeric>
            {pong}
          </Text>
        ) : null}
      </div>
    </section>
  )
}

/** Why the sidebar may be behind Slack. `stopped`: the engine has stopped for good and needs a restart. */
export type EngineNoticeKind = 'offline' | 'rate-limited' | 'stopped'

export interface EngineNoticeProps {
  readonly kind: EngineNoticeKind
  /** Starts the engine again. Offered only when it has stopped. */
  readonly onRestart?: () => void
}

const notices: Record<EngineNoticeKind, { readonly icon: PhosphorIcon; readonly title: string; readonly body: string }> = {
  offline: { icon: WifiSlash, title: "You're offline", body: "Juno shows what it has and catches up when you're back." },
  'rate-limited': { icon: HourglassMedium, title: 'Slack asked us to slow down', body: 'Juno will catch up in a minute.' },
  stopped: { icon: WarningCircle, title: 'Sync stopped', body: 'The topics here are kept. Restart to catch up.' },
}

/**
 * A quiet line in the sidebar header when what it shows may be
 * behind Slack (friendly-layer 7): what happened, what is kept, and one
 * action when the user has to act.
 */
export function EngineNotice({ kind, onRestart }: EngineNoticeProps) {
  const notice = notices[kind]
  return (
    <section aria-label="Sync" title={notice.body} {...stylex.props(styles.notice)}>
      <span {...stylex.props(styles.noticeIcon)}>
        <Icon icon={notice.icon} size={16} />
      </span>
      <span role="status" aria-label="Sync status" {...stylex.props(styles.noticeText)}>
        <Text variant="meta" tone="muted" truncate sx={styles.statusLine}>
          {notice.title}
        </Text>
      </span>
      {kind === 'stopped' && onRestart !== undefined ? (
        <button type="button" {...stylex.props(styles.restart)} onClick={onRestart}>
          Restart
        </button>
      ) : null}
    </section>
  )
}

export interface SyncProgressProps {
  /** Conversations read so far, out of `total`. Both absent while the sync is still listing them. */
  readonly done?: number
  readonly total?: number
}

/**
 * The first sync's progress, in the same place as the notices: a thin line
 * along the header’s bottom edge and "Syncing 30 of 143" in its fixed text slot. Shown
 * only until the first sync is done; later catch-ups are silent.
 */
export function SyncProgress({ done, total }: SyncProgressProps) {
  const counted = done !== undefined && total !== undefined && total > 0
  const fraction = counted ? Math.min(1, done / total) : 0
  const label = counted ? `Syncing ${done} of ${total}` : 'Syncing'
  return (
    <section aria-label="Sync" data-sync-progress="" {...stylex.props(styles.progress)}>
      <div
        role="progressbar"
        aria-label="Sync progress"
        aria-valuemin={0}
        aria-valuemax={counted ? total : undefined}
        aria-valuenow={counted ? done : undefined}
        {...stylex.props(styles.track)}
      >
        <div {...stylex.props(styles.fill, styles.fraction(fraction))} />
      </div>
      <Text variant="meta" tone="muted" numeric role="status" aria-label="Sync status" sx={styles.statusLine}>
        {label}
      </Text>
    </section>
  )
}

const styles = stylex.create({
  statusLine: { lineHeight: spacing['--space-4'] },
  progress: {
    position: 'relative',
    height: '100%',
    paddingInline: spacing['--space-4'],
  },
  track: {
    position: 'absolute',
    insetInline: 0,
    bottom: 0,
    height: spacing['--space-0-5'],
    backgroundColor: colors['--border-subtle'],
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors['--foreground-subtle'],
    transformOrigin: 'left',
    transitionProperty: 'transform',
    transitionDuration: { default: motion['--duration-appear'], '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: motion['--ease-out'],
  },
  fraction: (value: number) => ({ transform: `scaleX(${value})` }),
  notice: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    paddingInline: spacing['--space-4'],
    height: '100%',
  },
  noticeIcon: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  noticeText: {
    display: 'flex',
    flexGrow: 1,
    minWidth: 0,
  },
  restart: {
    borderWidth: 0,
    padding: 0,
    backgroundColor: 'transparent',
    color: colors['--foreground-default'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    lineHeight: 'inherit',
    textDecoration: 'underline',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
  },
})

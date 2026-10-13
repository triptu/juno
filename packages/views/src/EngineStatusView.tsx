import * as stylex from '@stylexjs/stylex'
import { HourglassMedium } from '@phosphor-icons/react/dist/icons/HourglassMedium'
import { WarningCircle } from '@phosphor-icons/react/dist/icons/WarningCircle'
import { WifiSlash } from '@phosphor-icons/react/dist/icons/WifiSlash'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Icon, Text, type PhosphorIcon } from '@juno/ui'

export interface EngineStatusViewProps {
  /** One short line, for example "Engine live". */
  readonly line: string
  /** The last answer to a ping, if any. */
  readonly pong?: string
  readonly onPing: () => void
}

/** The engine's phase as a status line, with a ping button for diagnostics. */
export function EngineStatusView({ line, pong, onPing }: EngineStatusViewProps) {
  return (
    <section {...stylex.props(styles.section)} aria-label="Engine">
      <Text variant="meta" tone="muted" numeric as="p" role="status" aria-label="Engine status">
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
 * A quiet line under the sidebar's filters when what it shows may be
 * behind Slack (friendly-layer 7): what happened, what is kept, and one
 * action when the user has to act.
 */
export function EngineNotice({ kind, onRestart }: EngineNoticeProps) {
  const notice = notices[kind]
  return (
    <section aria-label="Sync" {...stylex.props(styles.notice)}>
      <span {...stylex.props(styles.noticeIcon)}>
        <Icon icon={notice.icon} size={16} />
      </span>
      <span role="status" aria-label="Sync status" {...stylex.props(styles.noticeText)}>
        <Text variant="meta" weight="semibold" tone="default">
          {notice.title}
        </Text>
        <Text variant="meta" tone="muted">
          {notice.body}
        </Text>
      </span>
      {kind === 'stopped' && onRestart !== undefined ? (
        <Button variant="secondary" size="sm" onClick={onRestart}>
          Restart
        </Button>
      ) : null}
    </section>
  )
}

const styles = stylex.create({
  notice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-2'],
    paddingInline: spacing['--space-4'],
    paddingBottom: spacing['--space-2-5'],
  },
  noticeIcon: {
    display: 'inline-flex',
    flexShrink: 0,
    paddingTop: '1px',
    color: colors['--foreground-muted'],
  },
  noticeText: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
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

import * as stylex from '@stylexjs/stylex'
import { HourglassMedium } from '@phosphor-icons/react/dist/icons/HourglassMedium'
import { WarningCircle } from '@phosphor-icons/react/dist/icons/WarningCircle'
import { WifiSlash } from '@phosphor-icons/react/dist/icons/WifiSlash'
import type { ReactNode } from 'react'
import { colors, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Icon, ProgressRing, Text, type PhosphorIcon } from '@juno/ui'

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

// `line` fits the card at the narrowest sidebar; `body` is the full sentence, in the tooltip.
const notices: Record<EngineNoticeKind, { readonly icon: PhosphorIcon; readonly title: string; readonly line: string; readonly body: string }> = {
  offline: { icon: WifiSlash, title: "You're offline", line: "Juno catches up when you're back.", body: "Juno shows what it has and catches up when you're back." },
  'rate-limited': { icon: HourglassMedium, title: 'Slack asked us to slow down', line: 'Juno will catch up in a minute.', body: 'Juno will catch up in a minute.' },
  stopped: { icon: WarningCircle, title: 'Sync stopped', line: 'The topics here are kept.', body: 'The topics here are kept. Restart to catch up.' },
}

interface StatusCardProps {
  /** The ring, or the notice's icon, in a 20px slot. */
  readonly leading: ReactNode
  readonly title: string
  readonly line: string
  /** The full second line when it may be cut off. */
  readonly tooltip?: string
  readonly action?: ReactNode
}

/**
 * The card at the foot of the sidebar: a 20px leading slot, a title and
 * one line under it, and an optional button. Every state is the same
 * height, so one state replacing another moves nothing.
 */
function StatusCard({ leading, title, line, tooltip, action }: StatusCardProps) {
  return (
    <section aria-label="Sync" title={tooltip} data-sync-status="" {...stylex.props(styles.card)}>
      <span {...stylex.props(styles.leading)}>{leading}</span>
      <span {...stylex.props(styles.lines)}>
        <Text variant="ui" weight="medium" tone="default" truncate role="status" aria-label="Sync status" sx={styles.title}>
          {title}
        </Text>
        <Text variant="meta" tone="subtle" numeric truncate sx={styles.line}>
          {line}
        </Text>
      </span>
      {action}
    </section>
  )
}

/**
 * Why the sidebar may be behind Slack (friendly-layer 7), in the status
 * card at the foot of the sidebar: what happened, what is kept, and
 * Restart when the user has to act.
 */
export function EngineNotice({ kind, onRestart }: EngineNoticeProps) {
  const notice = notices[kind]
  return (
    <StatusCard
      leading={<Icon icon={notice.icon} size={18} />}
      title={notice.title}
      line={notice.line}
      tooltip={notice.body}
      action={
        kind === 'stopped' && onRestart !== undefined ? (
          <Button variant="raised" size="xs" onClick={onRestart}>
            Restart
          </Button>
        ) : undefined
      }
    />
  )
}

export interface SyncProgressProps {
  /** Conversations read so far, out of `total`. Both absent while the sync is still listing them. */
  readonly done?: number
  readonly total?: number
}

/**
 * The first sync's progress, in the same card as the notices: a ring,
 * "Syncing with Slack" and how many conversations are read. Shown only
 * until the first sync is done; later catch-ups are silent.
 */
export function SyncProgress({ done, total }: SyncProgressProps) {
  const counted = done !== undefined && total !== undefined && total > 0
  const line = counted ? `${done} of ${total} conversations` : 'Finding your conversations'
  return (
    <StatusCard
      leading={counted ? <ProgressRing label="Sync progress" value={done} max={total} valueText={line} /> : <ProgressRing label="Sync progress" valueText={line} />}
      title="Syncing with Slack"
      line={line}
    />
  )
}

const appear = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  // The privacy card's look, two lines tall: 10px around the 20px slot, the text and the button.
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    padding: spacing['--space-2-5'],
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-subtle'],
    animationName: appear,
    animationDuration: motion['--duration-appear'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  leading: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--icon-20'],
    height: sizes['--icon-20'],
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
  },
  title: { lineHeight: spacing['--space-5'] },
  line: { lineHeight: spacing['--space-4'] },
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

import * as stylex from '@stylexjs/stylex'
import { CloudWarning } from '@phosphor-icons/react/dist/icons/CloudWarning'
import { HourglassMedium } from '@phosphor-icons/react/dist/icons/HourglassMedium'
import { WarningCircle } from '@phosphor-icons/react/dist/icons/WarningCircle'
import { WifiSlash } from '@phosphor-icons/react/dist/icons/WifiSlash'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Icon, ProgressRing, Text, type PhosphorIcon } from '@juno/ui'
import { StatusCard } from './StatusCard'

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

/**
 * Why the sidebar may be behind Slack. `stopped`: the engine has stopped for
 * good and needs a restart. `failed`: the sync keeps failing for a reason
 * other than the network.
 */
export type EngineNoticeKind = 'offline' | 'failed' | 'rate-limited' | 'stopped'

export interface EngineNoticeProps {
  readonly kind: EngineNoticeKind
  /** Starts the engine again. Offered only when it has stopped. */
  readonly onRestart?: () => void
  /** `failed` only: the reason in plain words, one short sentence ("Slack sent data Juno can't read."). */
  readonly reason?: string
  /** `failed` only: puts the diagnostic log on the clipboard. */
  readonly onCopyLog?: () => void
}

// `line` fits the card at the narrowest sidebar; `body` is the full sentence, in the tooltip.
const notices: Record<EngineNoticeKind, { readonly icon: PhosphorIcon; readonly title: string; readonly line: string; readonly body: string }> = {
  offline: { icon: WifiSlash, title: "You're offline", line: "Juno catches up when you're back.", body: "Juno shows what it has and catches up when you're back." },
  // The line is the reason when there is one.
  failed: { icon: CloudWarning, title: "Couldn't finish syncing", line: 'Juno tries again every 30 seconds.', body: 'Juno tries again every 30 seconds. Copy the log and send it to us.' },
  'rate-limited': { icon: HourglassMedium, title: 'Slack asked us to slow down', line: 'Juno will catch up in a minute.', body: 'Juno will catch up in a minute.' },
  stopped: { icon: WarningCircle, title: 'Sync stopped', line: 'The topics here are kept.', body: 'The topics here are kept. Restart to catch up.' },
}

/**
 * Why the sidebar may be behind Slack (friendly-layer 7), in the status
 * card at the foot of the sidebar: what happened, what is kept, and
 * Restart or Copy log when the user has to act.
 */
export function EngineNotice({ kind, onRestart, reason, onCopyLog }: EngineNoticeProps) {
  const notice = notices[kind]
  const failedReason = kind === 'failed' ? reason : undefined
  return (
    <StatusCard
      label="Sync"
      statusLabel="Sync status"
      marker="sync"
      leading={<Icon icon={notice.icon} size={18} />}
      title={notice.title}
      line={failedReason ?? notice.line}
      tooltip={failedReason === undefined ? notice.body : `${failedReason} ${notice.body}`}
      action={
        kind === 'stopped' && onRestart !== undefined ? (
          <Button variant="raised" size="xs" onClick={onRestart}>
            Restart
          </Button>
        ) : kind === 'failed' && onCopyLog !== undefined ? (
          <Button variant="raised" size="xs" onClick={onCopyLog}>
            Copy log
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
      label="Sync"
      statusLabel="Sync status"
      marker="sync"
      leading={counted ? <ProgressRing label="Sync progress" value={done} max={total} valueText={line} /> : <ProgressRing label="Sync progress" valueText={line} />}
      title="Syncing with Slack"
      line={line}
    />
  )
}

const styles = stylex.create({
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

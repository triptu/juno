import * as stylex from '@stylexjs/stylex'
import { Button } from '@juno/ui'
import { colors, spacing, type } from '@juno/tokens/tokens.stylex'

export interface EngineStatusViewProps {
  /** One short line, for example "Engine live, up 12 s". */
  readonly line: string
  /** The last answer to a ping, if any. */
  readonly pong?: string
  readonly onPing: () => void
}

/** Dumb view: props in, callbacks out. */
export function EngineStatusView({ line, pong, onPing }: EngineStatusViewProps) {
  return (
    <section {...stylex.props(styles.section)} aria-label="Engine">
      <p {...stylex.props(styles.line)} role="status" aria-label="Engine status">
        {line}
      </p>
      <div {...stylex.props(styles.row)}>
        <Button onClick={onPing}>Ping engine</Button>
        {pong ? <span {...stylex.props(styles.pong)}>{pong}</span> : null}
      </div>
    </section>
  )
}

const styles = stylex.create({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
  },
  line: {
    margin: 0,
    fontSize: type['--text-sm'],
    color: colors['--foreground-muted'],
    fontVariantNumeric: 'tabular-nums',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
  },
  pong: {
    fontSize: type['--text-sm'],
    color: colors['--foreground-muted'],
    fontVariantNumeric: 'tabular-nums',
  },
})

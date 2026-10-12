import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'

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

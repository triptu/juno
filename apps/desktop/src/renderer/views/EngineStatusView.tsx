import * as stylex from '@stylexjs/stylex'
import { Button, Text } from '@juno/ui'
import { spacing } from '@juno/tokens/tokens.stylex'

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
      <div role="status" aria-label="Engine status">
        <Text role="meta" tone="muted" numeric as="p">
          {line}
        </Text>
      </div>
      <div {...stylex.props(styles.row)}>
        <Button onClick={onPing}>Ping engine</Button>
        {pong ? (
          <Text role="meta" tone="muted" numeric>
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

import * as stylex from '@stylexjs/stylex'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Button, systemWords, Text } from '@juno/ui'

export interface ProcessRow {
  /** Juno's name: "Engine", "Juno agent", "Window", "Graphics", "Network", "Main". */
  readonly name: string
  /** Electron's type and the pid, quieter: "Utility, pid 4127". */
  readonly detail: string
  /** "2.1 %". */
  readonly cpu: string
  /** "118 MB". */
  readonly memory: string
}

export interface ProcessesViewProps {
  /** Every Juno process, main first. Empty until the first reading. */
  readonly rows: ReadonlyArray<ProcessRow>
  /** "Copied" for a moment after a copy, or "Could not copy". */
  readonly copied?: string
  readonly onCopy: () => void
  readonly onShowLogs: () => void
}

/**
 * Settings › About › Diagnostics: CPU and memory per process, as the owner
 * would read them in Activity Monitor under "Juno Helper", with Juno's own
 * names, and Copy diagnostics for a plain-text report.
 */
export function ProcessesView({ rows, copied, onCopy, onShowLogs }: ProcessesViewProps) {
  return (
    <section {...stylex.props(styles.section)} aria-label="Processes">
      <table {...stylex.props(styles.table)}>
        <thead>
          <tr>
            <th scope="col" {...stylex.props(styles.head, styles.name)}>
              <Text variant="meta" tone="subtle">Process</Text>
            </th>
            <th scope="col" {...stylex.props(styles.head, styles.number)}>
              <Text variant="meta" tone="subtle">CPU</Text>
            </th>
            <th scope="col" {...stylex.props(styles.head, styles.number)}>
              <Text variant="meta" tone="subtle">Memory</Text>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.name} ${row.detail}`} data-process={row.name}>
              <td {...stylex.props(styles.cell, styles.name)}>
                <Text variant="meta" tone="default">{row.name}</Text>{' '}
                <Text variant="meta" tone="muted" numeric>{row.detail}</Text>
              </td>
              <td {...stylex.props(styles.cell, styles.number)}>
                <Text variant="meta" tone="default" numeric>{row.cpu}</Text>
              </td>
              <td {...stylex.props(styles.cell, styles.number)}>
                <Text variant="meta" tone="default" numeric>{row.memory}</Text>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div {...stylex.props(styles.row)}>
        <Button onClick={onCopy}>Copy diagnostics</Button>
        <Button onClick={onShowLogs}>Show logs in {systemWords.fileManager}</Button>
        {copied === undefined ? null : (
          <Text variant="meta" tone="muted" role="status">
            {copied}
          </Text>
        )}
      </div>
    </section>
  )
}

const styles = stylex.create({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  head: {
    paddingBlockEnd: spacing['--space-1'],
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colors['--border-default'],
    fontWeight: 'inherit',
  },
  cell: {
    paddingBlock: spacing['--space-1'],
  },
  name: { textAlign: 'start' },
  // Figures line up on their right edge, as Activity Monitor's columns do.
  number: {
    textAlign: 'end',
    width: spacing['--space-18'],
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing['--space-2'],
  },
})

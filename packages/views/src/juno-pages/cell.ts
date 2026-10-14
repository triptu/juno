/** The layouts the Juno pages share: a two-line cell inside a ListRow, and a row of trailing controls. */
import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'

export const cell = stylex.create({
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    minWidth: 0,
  },
  line: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    paddingBlock: spacing['--space-2'],
    minWidth: 0,
  },
  wrap: {
    textWrap: 'pretty',
  },
})

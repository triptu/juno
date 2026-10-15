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
  // A form inside a row: it takes the row's whole width, so its fields span
  // the card between the row's insets instead of shrinking to their placeholders.
  field: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    gap: spacing['--space-2'],
    paddingBlock: spacing['--space-2'],
    minWidth: 0,
  },
  wrap: {
    textWrap: 'pretty',
  },
})

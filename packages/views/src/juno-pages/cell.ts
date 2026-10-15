/** The layouts the Juno pages share: a two-line cell inside a ListRow, a row of trailing controls, and a chip that ends a row. */
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
  // A chip that ends a row, in a card whose other rows end with xs ghost
  // buttons, ends where their text ends: their 8px padding and 1px border in from the
  // row's 15px inset, 24px from the card's edge.
  chip: {
    display: 'inline-flex',
  },
  endChip: {
    marginInlineEnd: `calc(${spacing['--space-2']} + 1px)`,
  },
})

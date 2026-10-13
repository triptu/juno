import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, fixture } from './fixtures/define'
import { ScrollArea, type ScrollAreaProps } from './ScrollArea'
import { Text } from './Text'

const styles = stylex.create({
  area: {
    height: '100%',
    paddingInline: spacing['--space-3'],
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    paddingBlock: spacing['--space-3'],
  },
})

const lines = Array.from({ length: 40 }, (_, index) => `Line ${index + 1} of a long list`)

const content = (
  <div {...stylex.props(styles.list)}>
    {lines.map((line) => (
      <Text key={line} variant="ui" tone="default" as="p">
        {line}
      </Text>
    ))}
  </div>
)

const area = (scrollbar: ScrollAreaProps['scrollbar']): ScrollAreaProps => ({
  scrollbar,
  'aria-label': 'Scroll area',
  sx: styles.area,
  children: content,
})

export default defineFixtures(
  ScrollArea,
  {
    Scrollbar: {
      always: fixture(area('always')),
      hover: fixture(area('hover')),
    },
    Interaction: {
      // The thumb appears; the gutter was already there, so nothing moves.
      'hover-hovered': fixture(area('hover'), { hover: '[data-scroll-area]' }),
    },
  },
  { width: 320, height: 200, padded: false, surface: 'subtle' },
)


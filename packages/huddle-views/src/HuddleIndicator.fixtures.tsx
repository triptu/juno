import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, fixture, scene, Text, TooltipLayer } from '@juno/ui'
import { HuddleIndicator } from './HuddleIndicator'

// A Main row's first line as TopicRow draws it: the title, then what follows it.
function TitleLine({ title, count }: { readonly title: string; readonly count: number }) {
  return (
    <span {...stylex.props(styles.line)}>
      <Text variant="rowTitle" tone="default" truncate>
        {title}
      </Text>
      <HuddleIndicator count={count} />
    </span>
  )
}

export default defineFixtures(
  HuddleIndicator,
  {
    Glyph: {
      one: fixture({ count: 1 }),
      three: fixture({ count: 3 }),
    },
    'In a row': {
      channel: scene(() => <TitleLine title="eng" count={3} />, { width: 320, surface: 'subtle' }),
      dm: scene(() => <TitleLine title="Maya Chen" count={2} />, { width: 320, surface: 'subtle' }),
      tooltip: scene(
        () => (
          <>
            <TitleLine title="eng" count={3} />
            <TooltipLayer />
          </>
        ),
        { width: 320, height: 80, surface: 'subtle', tooltip: '[data-huddle-indicator]' },
      ),
    },
  },
)

const styles = stylex.create({
  line: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
  },
})

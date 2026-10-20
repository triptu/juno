import * as stylex from '@stylexjs/stylex'
import { layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'

/**
 * In the composer's place where the topic can be read, not written to: a DM
 * with a deactivated person (SPEC 7, "People"). As tall as the composer.
 */
export function ReadOnlyNote({ text }: { readonly text: string }) {
  return (
    <div data-read-only-note="" {...stylex.props(styles.outer)}>
      <Text variant="meta" tone="muted" as="p" sx={styles.note}>
        {text}
      </Text>
    </div>
  )
}

const styles = stylex.create({
  // The composer's room (`ComposerSlot`).
  outer: {
    flexShrink: 0,
    width: '100%',
    paddingTop: spacing['--space-2'],
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-5'],
    boxSizing: 'border-box',
  },
  note: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: layout['--composer-width'],
    height: sizes['--control-40'],
    marginInline: 'auto',
    textAlign: 'center',
  },
})

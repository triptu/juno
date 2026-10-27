import * as stylex from '@stylexjs/stylex'
import { layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Text } from '@juno/ui'

export interface ReadOnlyNoteProps {
  readonly text: string
  /** A button after the text: Join channel on a channel's preview. */
  readonly action?: { readonly label: string; readonly onAction: () => void }
}

/**
 * In the composer's place where the topic can be read, not written to: a DM
 * with a deactivated person (SPEC 7, "People"), or a channel you are not in
 * (SPEC 7, "Not in the channel"). As tall as the composer.
 */
export function ReadOnlyNote({ text, action }: ReadOnlyNoteProps) {
  return (
    <div data-read-only-note="" {...stylex.props(styles.outer)}>
      <div {...stylex.props(styles.note)}>
        <Text variant="meta" tone="muted" as="p">
          {text}
        </Text>
        {action === undefined ? null : (
          <Button size="sm" variant="secondary" onClick={action.onAction}>
            {action.label}
          </Button>
        )}
      </div>
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
    gap: spacing['--space-3'],
    maxWidth: layout['--composer-width'],
    height: sizes['--control-40'],
    marginInline: 'auto',
    textAlign: 'center',
  },
})

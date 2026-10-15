import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'

export interface NewChatProps {
  /** The destination's latest messages, read-only (a `MessageList`). Nothing before a destination is picked. */
  readonly preview?: ReactNode
  /** One muted line in the middle when there is no preview. */
  readonly note?: string
  /** The `Composer`, with the `DestinationPickers` above its field. */
  readonly composer: ReactNode
}

/** The line a New chat shows before a destination is picked. */
export const NEW_CHAT_NOTE = 'Write your message, then pick where it goes.'

/** The line in place of the preview for a person never messaged. */
export const startOfConversation = (name: string) => `This is the start of your conversation with ${name}.`

/**
 * A New chat in a tab (spec section 9, inventory 8): a topic without its
 * header. The preview, or one muted line, fills the middle; the pickers and
 * the composer sit at the bottom, where the topic's composer will be.
 */
export function NewChat({ preview, note = NEW_CHAT_NOTE, composer }: NewChatProps) {
  return (
    <div data-new-chat="" {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.middle)}>
        {preview ?? (
          <div {...stylex.props(styles.note)}>
            <Text variant="body" tone="muted">
              {note}
            </Text>
          </div>
        )}
      </div>
      {composer}
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors['--background'],
  },
  middle: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
  },
  note: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    paddingInline: spacing['--space-6'],
    textAlign: 'center',
    userSelect: 'none',
  },
})

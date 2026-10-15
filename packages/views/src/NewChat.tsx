import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { PickConversation } from '@juno/contract'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'
import { FrequentConversations } from './FrequentConversations'

export interface NewChatProps {
  readonly frequent?: ReadonlyArray<PickConversation>
  readonly selectedConversation?: string | undefined
  readonly onPickConversation?: (conversation: PickConversation) => void
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
 * header. Frequent destinations, a preview, or one muted line fill the middle; the pickers and
 * the composer sit at the bottom, where the topic's composer will be.
 */
export function NewChat({ preview, note = NEW_CHAT_NOTE, composer, frequent = [], selectedConversation, onPickConversation }: NewChatProps) {
  return (
    <div data-new-chat="" {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.middle)}>
        {frequent.length > 0 && onPickConversation !== undefined ? (
          <div {...stylex.props(styles.frequentArea)}>
            <div {...stylex.props(styles.column)}>
              <FrequentConversations conversations={frequent} selected={selectedConversation} onPick={onPickConversation} />
              <Text variant="body" tone="muted">{NEW_CHAT_NOTE}</Text>
            </div>
          </div>
        ) : preview ?? (
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
  frequentArea: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    paddingInline: spacing['--space-6'],
    paddingBlock: spacing['--space-4'],
    overflowY: 'auto',
  },
  column: {
    width: '100%',
    maxWidth: layout['--composer-width'],
    marginInline: 'auto',
    marginBlock: 'auto',
    boxSizing: 'border-box',
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

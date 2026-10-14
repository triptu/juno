import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import { chatCopy, type NoteItem } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'
import type { ChatActions } from './commands'
import { TextButton } from './TextButton'

export interface NoteProps {
  readonly item: NoteItem
  readonly actions: ChatActions
}

/** A quiet centred line between bubbles: "Remembered · Undo", "Removed", or the fixed secret-blocked line. */
export const Note = memo(function Note({ item, actions }: NoteProps) {
  const copy = chatCopy.note
  return (
    <div data-chat-note={item.kind} {...stylex.props(styles.root)}>
      <Text variant="meta" tone="muted" dir="auto" sx={styles.text}>
        {item.kind === 'remembered' ? (
          <>
            {copy.remembered}
            {item.undo ? (
              <>
                {' · '}
                <TextButton onClick={() => actions.onUndoNote(item.id)}>{copy.undo}</TextButton>
              </>
            ) : null}
          </>
        ) : item.kind === 'removed' ? (
          copy.removed
        ) : (
          copy.secretBlocked
        )}
      </Text>
    </div>
  )
})

const styles = stylex.create({
  root: {
    display: 'flex',
    justifyContent: 'center',
    paddingBlock: spacing['--space-0-5'],
    marginTop: spacing['--space-2'],
    userSelect: 'none',
  },
  text: {
    textAlign: 'center',
    textWrap: 'pretty',
  },
})

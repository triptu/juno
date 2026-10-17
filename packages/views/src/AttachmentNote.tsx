import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'

export interface AttachmentNoteProps {
  /** The composer's file chips. */
  readonly chips: ReactNode
  /** One short line about them: "Juno reads text only. Pick a person or channel to send files." */
  readonly note: string
}

/**
 * The file chips with a quiet line under them, in the composer's
 * attachments slot. Home uses it while Juno is chosen and files are
 * attached (SPEC 12, "Writing"): a send to Juno takes the text, and the
 * files stay for a person or channel.
 */
export function AttachmentNote({ chips, note }: AttachmentNoteProps) {
  return (
    <div {...stylex.props(styles.stack)}>
      {chips}
      <div data-attachment-note="" role="status" {...stylex.props(styles.note)}>
        <Text variant="meta" tone="muted">
          {note}
        </Text>
      </div>
    </div>
  )
}

const styles = stylex.create({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
    flexGrow: 1,
    minWidth: 0,
  },
  // On the chips' edge, so the line reads as theirs.
  note: {
    paddingInline: spacing['--space-1'],
    minWidth: 0,
  },
})

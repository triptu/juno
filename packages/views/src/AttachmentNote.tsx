import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'

export interface AttachmentNoteProps {
  /** The composer's file chips. */
  readonly chips: ReactNode
  /** One short line about the files a send to Juno leaves: "This model can't read images. Choose another in Settings › Juno." */
  readonly note: string
}

/**
 * The file chips with a quiet line under them, in the composer's
 * attachments slot. Home, the Juno tab and the panel use it while Juno is
 * where the draft goes and some files are ones Juno cannot take (SPEC 12,
 * "Writing"): a send to Juno takes the rest, and these stay.
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

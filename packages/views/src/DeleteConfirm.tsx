import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Surface, Text } from '@juno/ui'

export interface DeleteConfirmProps {
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * The inline delete confirm (ADR 0010, inventory 6.5): Delete… on your own
 * message asks "Delete this message?" with Cancel and Delete, at the
 * message's top right. Enter and Esc are the row's keys; the container
 * handles them.
 */
export function DeleteConfirm({ onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <Surface kind="toolbar" padding="none" radius="pill" role="group" aria-label="Delete this message?" data-delete-confirm="" sx={styles.confirm}>
      <Text variant="meta" tone="default" as="span" sx={styles.question}>
        Delete this message?
      </Text>
      <Button variant="ghost" size="xs" tone="subtle" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="primary" size="xs" kbd="↵" onClick={onConfirm}>
        Delete
      </Button>
    </Surface>
  )
}

const styles = stylex.create({
  // 22px buttons with a 2px inset and the 1px border: --toolbar-height.
  confirm: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    padding: spacing['--space-0-5'],
  },
  question: {
    paddingInline: spacing['--space-2'],
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
})

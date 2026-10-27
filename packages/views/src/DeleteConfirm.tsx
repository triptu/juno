import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { spacing, z } from '@juno/tokens/tokens.stylex'
import { Button, Surface, Text } from '@juno/ui'

export interface DeleteConfirmProps {
  readonly onConfirm: () => void
  readonly onCancel: () => void
  /** "Delete this message?" unless given: Leave channel… on a private channel asks "Leave #eng? You'll need an invite to come back." */
  readonly question?: string
  /** "Delete" unless given. */
  readonly confirmLabel?: string
}

/**
 * The inline delete confirm (ADR 0010, inventory 6.5): Delete… on your own
 * message asks "Delete this message?" with Cancel and Delete, at the
 * message's top right. Enter and Esc are the row's keys; the container
 * handles them. Leaving a private channel asks in the same pill (SPEC 5).
 */
export function DeleteConfirm({ onConfirm, onCancel, question = 'Delete this message?', confirmLabel = 'Delete' }: DeleteConfirmProps) {
  return (
    <Surface kind="toolbar" padding="none" radius="pill" role="group" aria-label={question} data-delete-confirm="" sx={styles.confirm}>
      <Text variant="meta" tone="default" as="span" sx={styles.question}>
        {question}
      </Text>
      <Button variant="ghost" size="xs" tone="subtle" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="primary" size="xs" kbd="↵" onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </Surface>
  )
}

export interface DeleteConfirmAtProps extends DeleteConfirmProps {
  /** Where it shows, in window coordinates: where a native menu opened. */
  readonly at: { readonly x: number; readonly y: number }
  /** The box, for the container to tell a press inside it from one outside. */
  readonly boxRef?: RefObject<HTMLDivElement | null>
}

/**
 * The same pill floating at a point over the window, for a question asked
 * from a native menu (Leave channel… on a private channel, SPEC 5). It stays
 * inside the window and puts focus on its confirm button.
 */
export function DeleteConfirmAt({ at, boxRef, ...props }: DeleteConfirmAtProps) {
  const own = useRef<HTMLDivElement>(null)
  const ref = boxRef ?? own
  useLayoutEffect(() => {
    const box = ref.current
    if (box === null) return
    const over = box.getBoundingClientRect().right + Number.parseFloat(getComputedStyle(box).paddingRight) - document.documentElement.clientWidth
    if (over > 0) box.style.translate = `${-over}px 0`
    box.querySelector<HTMLButtonElement>('button:last-of-type')?.focus()
  }, [ref])
  return (
    <div ref={ref} data-confirm-at="" {...stylex.props(styles.at(at.x, at.y))}>
      <DeleteConfirm {...props} />
    </div>
  )
}

const styles = stylex.create({
  // The edge gap is the padding: a pill near the right edge moves in by it.
  at: (x: number, y: number) => ({
    position: 'fixed',
    top: y,
    left: x,
    paddingRight: spacing['--space-2'],
    zIndex: z['--z-context'],
  }),
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

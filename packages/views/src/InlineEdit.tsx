import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Surface, Textarea } from '@juno/ui'

export interface InlineEditProps {
  /** The text being edited: the owner's. */
  readonly value: string
  readonly onChange: (value: string) => void
  /** Enter, or Save. */
  readonly onSave: () => void
  /** Esc, or Cancel. */
  readonly onCancel: () => void
}

/**
 * Editing one of your own messages in place (SPEC section 7; ADR 0010): the
 * message's body becomes a field with its text, focused with the caret at
 * the end. Enter saves, Shift Enter adds a line, Esc cancels; Cancel and
 * Save under it do the same. The field grows with its text like the
 * composer, up to the composer's height.
 */
export function InlineEdit({ value, onChange, onSave, onCancel }: InlineEditProps) {
  const field = useRef<HTMLTextAreaElement>(null)
  // Focus once, with the caret after the text, before the first paint.
  useLayoutEffect(() => {
    const element = field.current
    if (element === null) return
    element.focus({ preventScroll: true })
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // The list's keys (arrows, E, Delete) never act on the row while its field has focus.
    event.stopPropagation()
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSave()
    }
  }
  return (
    <div data-inline-edit="" {...stylex.props(styles.root)}>
      <Surface kind="field" sx={styles.box}>
        <Textarea ref={field} variant="inline" maxHeight="composer" label="Edit message" value={value} onChange={(event) => onChange(event.currentTarget.value)} onKeyDown={onKeyDown} dir="auto" />
      </Surface>
      <div {...stylex.props(styles.buttons)}>
        <Button variant="ghost" size="sm" tone="subtle" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" kbd="↵" dimmed={value.trim() === ''} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    width: '100%',
    maxWidth: layout['--composer-width'],
    marginBlock: spacing['--space-0-5'],
  },
  box: {
    display: 'flex',
    width: '100%',
    paddingInline: spacing['--space-3'],
    boxSizing: 'border-box',
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacing['--space-1'],
  },
})

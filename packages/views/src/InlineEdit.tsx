import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Surface, Textarea, type TextareaFormat } from '@juno/ui'
import { mentionProps, type ComposerMention } from './Composer'

export interface InlineEditProps {
  /** The text being edited: the owner's. */
  readonly value: string
  /** With the caret's offset after the change. */
  readonly onChange: (value: string, caret: number) => void
  /** Enter, or Save. */
  readonly onSave: () => void
  /** Esc, or Cancel. */
  readonly onCancel: () => void
  /** The field, for the owner's emoji suggestions to write to. */
  readonly fieldRef?: RefObject<HTMLTextAreaElement | null>
  /** The `:emoji:` suggestions while they are open, above the field as in the composer (SPEC 8). */
  readonly mention?: ComposerMention
  /** Sees every key first; true when it took the key (the suggestions' arrows, Enter, Tab, Esc). */
  readonly onFieldKey?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** The caret moved without the text changing. */
  readonly onCaret?: (caret: number) => void
  /** Slack's markup in the text, drawn as it will look, as in the composer. */
  readonly format?: TextareaFormat
}

/**
 * Editing one of your own messages in place (SPEC section 7; ADR 0010): the
 * message's body becomes a field with its text, focused with the caret at
 * the end and scrolled into view whole. Enter saves, Shift Enter adds a
 * line, Esc cancels; Cancel and Save under it do the same. The field grows with its text like the
 * composer, up to the composer's height. `:emoji:` suggestions open above
 * it as in the composer, and take their keys first. Markup shows as it
 * will look, as in the composer.
 */
export function InlineEdit({ value, onChange, onSave, onCancel, fieldRef, mention, onFieldKey, onCaret, format }: InlineEditProps) {
  const own = useRef<HTMLTextAreaElement>(null)
  const field = fieldRef ?? own
  const root = useRef<HTMLDivElement>(null)
  // Focus once, with the caret after the text, before the first paint. The field and its buttons are taller than the
  // body they replace, so a message near the bottom of the list is scrolled until they show whole.
  useLayoutEffect(() => {
    const element = field.current
    if (element === null) return
    element.focus({ preventScroll: true })
    element.setSelectionRange(element.value.length, element.value.length)
    root.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [field])
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // The list's keys (arrows, E, Delete) never act on the row while its field has focus.
    event.stopPropagation()
    if (event.nativeEvent.isComposing || onFieldKey?.(event) === true) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSave()
    }
  }
  return (
    <div ref={root} data-inline-edit="" {...stylex.props(styles.root)}>
      <Surface kind="field" sx={styles.box}>
        <Textarea
          ref={field}
          variant="inline"
          maxHeight="composer"
          label="Edit message"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          {...mentionProps(undefined, mention, onCaret)}
          {...(format === undefined ? {} : { format })}
          dir="auto"
        />
      </Surface>
      {mention?.list}
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
  // The suggestions are placed against the field box (`MentionSuggestions`), as in the composer.
  root: {
    position: 'relative',
    anchorScope: 'all',
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
    anchorName: '--composer-box',
    paddingInline: spacing['--space-3'],
    boxSizing: 'border-box',
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacing['--space-1'],
  },
})

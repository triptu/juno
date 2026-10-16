import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { layout, spacing, z } from '@juno/tokens/tokens.stylex'
import { Button, Surface, TextField } from '@juno/ui'

// StyleX reads only static values, so the anchor names are written here as
// well: the composer's field box (`Composer`) and the first selected
// character (`Textarea`'s `TEXTAREA_ANCHOR`).
const COMPOSER_BOX_ANCHOR = '--composer-box'
const TEXTAREA_ANCHOR = '--textarea-anchor'

export interface LinkEditorProps {
  /** The link the words have now, or "" for words with none. */
  readonly url: string
  /** Enter or Save, with the text as typed. The owner decides whether it is a link; false keeps the editor open, marked invalid. */
  readonly onSave: (url: string) => boolean
  /** Remove: the words keep their text and lose the link. Only for words that have one. */
  readonly onRemove?: () => void
  /** Esc, or focus leaving the editor. */
  readonly onCancel: () => void
}

/**
 * The link editor (inventory 7.1): ⌘K on words selected in the composer.
 * A small panel above the field, lined up under the words, with the URL
 * field focused and its text selected. Enter saves, Esc cancels; Remove
 * takes a link off.
 */
export function LinkEditor({ url, onSave, onRemove, onCancel }: LinkEditorProps) {
  const field = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(url)
  const [invalid, setInvalid] = useState(false)
  useLayoutEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])
  const save = () => setInvalid(!onSave(value))
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }
  return (
    <div
      data-link-editor=""
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onCancel()
      }}
      {...stylex.props(styles.panel)}
    >
      <Surface kind="popover" sx={styles.surface}>
        <TextField
          ref={field}
          size={30}
          label="Link"
          placeholder="Paste or type a link"
          value={value}
          invalid={invalid}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setValue(event.currentTarget.value)
            setInvalid(false)
          }}
          onKeyDown={onKeyDown}
        />
        {onRemove === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={save}>
          Save
        </Button>
      </Surface>
    </div>
  )
}

const styles = stylex.create({
  // Above the field box with the usual 6px gap, never over the text, kept inside the box's width.
  panel: {
    position: 'absolute',
    zIndex: z['--z-mention'],
    width: layout['--menu-width-picker'],
    bottom: `anchor(${COMPOSER_BOX_ANCHOR} top)`,
    marginBottom: spacing['--space-1-5'],
    left: `clamp(anchor(${COMPOSER_BOX_ANCHOR} left), anchor(${TEXTAREA_ANCHOR} left), calc(anchor(${COMPOSER_BOX_ANCHOR} right) - ${layout['--menu-width-picker']}))`,
    WebkitAppRegion: 'no-drag',
  },
  surface: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
  },
})

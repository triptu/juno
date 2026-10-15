import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { accent, colors, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'

export interface RenameFieldProps {
  /** The title it starts with, preselected. */
  readonly title: string
  /** `row`: 24px in a sidebar row (inventory 3.2). `header`: 28px in the title island (inventory 5). */
  readonly size: 'row' | 'header'
  /** Enter or leaving the field: the text as typed. The owner decides what an empty title means. */
  readonly onSave: (title: string) => void
  /** Esc. */
  readonly onCancel: () => void
}

/** A one-off size: the row field sits 2px into the line above and below, so the row keeps its height (inventory 3.2). */
const ROW_FIELD_MARGIN = '-2px'
/** The header title's floor (`HeaderTitleButton`), so the field never makes the island narrower than the title was allowed to be. */
const HEADER_FIELD_MIN_WIDTH = '72px'

/**
 * The title as a field, in place, for Rename (SPEC 5, inventory 3.2 and 5).
 * It takes focus with its text selected. Enter and leaving the field save;
 * Esc cancels. It sizes to its text, between the title button's floor and
 * the space it has.
 */
export function RenameField({ title, size, onSave, onCancel }: RenameFieldProps) {
  const ref = useRef<HTMLInputElement>(null)
  // Enter or Esc ends the edit; the blur that follows must not save again.
  const ended = useRef(false)

  useLayoutEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const end = (save: boolean) => {
    if (ended.current) return
    ended.current = true
    if (save) onSave(ref.current?.value ?? title)
    else onCancel()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      end(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      end(false)
    }
  }

  return (
    <input
      ref={ref}
      type="text"
      defaultValue={title}
      aria-label="Title"
      dir="auto"
      spellCheck={false}
      autoComplete="off"
      data-rename-field=""
      onKeyDown={onKeyDown}
      onBlur={() => end(true)}
      onPointerDown={(event) => event.stopPropagation()}
      {...stylex.props(styles.field, size === 'row' ? styles.row : styles.header)}
    />
  )
}

const styles = stylex.create({
  field: {
    appearance: 'none',
    boxSizing: 'border-box',
    minWidth: 0,
    margin: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--border-strongest'],
    backgroundColor: colors['--surface-default'],
    color: colors['--foreground-default'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-body-small-size'],
    fontWeight: weights['--weight-semibold'],
    cursor: 'text',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
  },
  row: {
    flexGrow: 1,
    height: sizes['--control-24'],
    marginBlock: ROW_FIELD_MARGIN,
    paddingBlock: 0,
    paddingInline: spacing['--space-1-5'],
    borderRadius: radii['--radius-md'],
  },
  header: {
    // As wide as its text, like the title it replaces, within the island.
    fieldSizing: 'content',
    flexShrink: 1,
    minWidth: HEADER_FIELD_MIN_WIDTH,
    maxWidth: '100%',
    height: sizes['--control-28'],
    paddingBlock: 0,
    paddingInline: spacing['--space-2'],
    borderRadius: radii['--radius-pill'],
  },
})

/**
 * The Search tab's field (SPEC 10a, inventory 9a): the chips the query's
 * filters became, then the typed words, in one 36px box across the tab.
 * Typing `from:` or `in:` opens the picker under the operator. A click on a
 * chip edits it; Backspace at the field's start, or on a focused chip,
 * removes it.
 */
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { X } from '@phosphor-icons/react/dist/icons/X'
import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { colors, layout, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Icon, IconButton } from '@juno/ui'
import { FieldChip } from './FieldChip'
import type { SearchChipView } from './model'
import { pickRowId, SearchPicker, usePickerKeys, type SearchFieldPicker } from './SearchPicker'

export interface SearchFieldProps {
  readonly chips: ReadonlyArray<SearchChipView>
  readonly text: string
  readonly inputRef?: Ref<HTMLInputElement>
  /** The words typed, and where the caret is, for the picker. */
  readonly onText: (text: string, caret: number) => void
  /** A click on a chip: edit it. */
  readonly onChip: (key: string) => void
  readonly onRemoveChip: (key: string) => void
  /** × at the field's end: chips and words go. */
  readonly onClear: () => void
  /** Keys the field and the picker leave: Enter, ↓, Esc. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  readonly onFocus?: () => void
  readonly picker?: SearchFieldPicker | undefined
}

const PLACEHOLDER = 'Search messages and topics'

export function SearchField({ chips, text, inputRef, onText, onChip, onRemoveChip, onClear, onKeyDown, onFocus, picker }: SearchFieldProps) {
  const keys = usePickerKeys(picker)
  const { field: fieldRef, mirror, left } = usePickerLeft(picker?.at, text, chips.length)

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || keys.onKey(event)) return
    const input = event.currentTarget
    const last = chips.at(-1)
    if (event.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0 && last !== undefined) {
      event.preventDefault()
      return onRemoveChip(last.key)
    }
    onKeyDown(event)
  }

  return (
    <div ref={fieldRef} {...stylex.props(styles.field)}>
      <span {...stylex.props(styles.glass)}>
        <Icon icon={MagnifyingGlass} size={15} />
      </span>
      <div {...stylex.props(styles.content)}>
        {chips.map((chip) => (
          <FieldChip key={chip.key} chip={chip} onEdit={() => onChip(chip.key)} onRemove={() => onRemoveChip(chip.key)} />
        ))}
        <span {...stylex.props(styles.inputSlot)}>
          <span ref={mirror} aria-hidden="true" {...stylex.props(styles.mirror)}>
            {text.slice(0, picker?.at ?? 0)}
          </span>
          <input
            ref={inputRef}
            data-search-field=""
            role="combobox"
            aria-label="Search"
            aria-expanded={picker !== undefined}
            aria-controls={picker === undefined ? undefined : 'search-picker'}
            aria-activedescendant={keys.activeId === undefined ? undefined : pickRowId(keys.activeId)}
            aria-autocomplete="list"
            placeholder={chips.length === 0 ? PLACEHOLDER : undefined}
            spellCheck={false}
            autoComplete="off"
            value={text}
            data-sensitive=""
            onChange={(event) => onText(event.target.value, event.target.selectionStart ?? event.target.value.length)}
            onKeyDown={onInputKey}
            onFocus={onFocus}
            {...stylex.props(styles.input)}
          />
        </span>
      </div>
      {chips.length > 0 || text !== '' ? <IconButton icon={X} label="Clear search" size={24} iconSize={13} onClick={onClear} /> : null}
      {picker === undefined || picker.rows.length === 0 ? null : <SearchPicker picker={picker} left={left} activeId={keys.activeId} onActivate={keys.activate} />}
    </div>
  )
}

/** Where the operator starts, from the field's left edge: one read when the picker opens or its operator moves. */
function usePickerLeft(at: number | undefined, text: string, chipCount: number) {
  const field = useRef<HTMLDivElement>(null)
  const mirror = useRef<HTMLSpanElement>(null)
  const [value, setValue] = useState(0)
  const known = at === undefined ? undefined : `${at}:${chipCount}:${text.slice(0, at)}`
  useLayoutEffect(() => {
    const input = field.current?.querySelector('input')
    const measure = mirror.current
    if (known === undefined || input == null || measure === null) return
    // oxlint-disable-next-line react/set-state-in-effect -- a layout read once per opening, before paint.
    setValue(input.offsetLeft + measure.offsetWidth - input.scrollLeft)
  }, [known])
  return { field, mirror, left: value }
}

const styles = stylex.create({
  // 36px with one line; it grows with wrapped chips. Input border, surface fill, as a text field.
  field: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minHeight: sizes['--control-36'],
    boxSizing: 'border-box',
    paddingBlock: `calc(${spacing['--space-1']} + ${spacing['--space-pixel']})`, // tokens-allow: 5px keeps a 24px chip centred in the 36px box with its 1px border.
    paddingInlineStart: spacing['--space-2-5'],
    paddingInlineEnd: spacing['--space-1-5'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--input-border'],
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--surface-default'],
  },
  glass: {
    display: 'flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  content: {
    flexGrow: 1,
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing['--space-1-5'],
    rowGap: spacing['--space-1'],
    minHeight: sizes['--control-24'],
  },
  inputSlot: {
    position: 'relative',
    flexGrow: 1,
    flexBasis: layout['--keyword-field-width'],
    minWidth: 0,
    display: 'flex',
  },
  // The words before the operator, laid out like the input's text, to find where the operator starts.
  mirror: {
    position: 'absolute',
    insetInlineStart: 0,
    top: 0,
    visibility: 'hidden',
    whiteSpace: 'pre',
    fontSize: text['--text-ui-size'],
    fontFamily: 'inherit',
    pointerEvents: 'none',
  },
  input: {
    flexGrow: 1,
    minWidth: 0,
    height: sizes['--control-24'],
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors['--foreground-default'],
    fontFamily: 'inherit',
    fontSize: text['--text-ui-size'],
    outlineStyle: 'none',
    '::placeholder': { color: colors['--foreground-muted'] },
  },
})

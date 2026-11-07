import * as stylex from '@stylexjs/stylex'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { StatusEmoji } from '@juno/contract'
import { colors, layout, radii, sizes, spacing, z } from '@juno/tokens/tokens.stylex'
import { Button, focusRing, IconButton, OptionList, OptionRow, Select, SmileyPlus, Surface, Text, TextField, useOptionListKeys } from '@juno/ui'
import { usePickerFocus, usePickerPlace } from './anchoredPicker'
import { EmojiFace } from './StatusLine'

export interface StatusSheetPreset<V extends string> {
  readonly emoji: StatusEmoji
  readonly text: string
  /** What choosing it sets Clear after to. */
  readonly clearAfter: V
  /** "1 hour", "Today", "Don’t clear": that choice's label. */
  readonly clearAfterLabel: string
}

export interface StatusSheetProps<V extends string> {
  /** The chosen emoji; none until one is picked or a preset fills it. */
  readonly emoji?: StatusEmoji | undefined
  /** What the emoji button shows while there is text and no emoji: what Save sends (Slack's 💬). */
  readonly textEmoji?: StatusEmoji | undefined
  readonly text: string
  /** Slack's limit, in characters. */
  readonly maxLength: number
  /** Slack's presets, shown while the field is empty. */
  readonly presets: ReadonlyArray<StatusSheetPreset<V>>
  /** The Clear after choices; an existing status that clears later adds its own time first. */
  readonly clearAfterOptions: ReadonlyArray<{ readonly value: V; readonly label: string }>
  readonly clearAfter: V
  /** You have a status now: Clear status shows. */
  readonly hasStatus: boolean
  /** Save or Clear status is waiting for Slack. */
  readonly busy?: boolean
  /** Why the last try failed, in plain words. */
  readonly error?: string | undefined
  /** The open emoji picker, floated under the emoji button. */
  readonly picker?: ReactNode
  readonly onEmoji: () => void
  /** A press or focus outside the open picker. */
  readonly onClosePicker?: () => void
  readonly onTextChange: (text: string) => void
  /** The field's clear button: the text and the emoji go. */
  readonly onClearField: () => void
  readonly onPreset: (preset: StatusSheetPreset<V>) => void
  readonly onClearAfterChange: (value: V) => void
  readonly onSave: () => void
  readonly onClearStatus: () => void
  readonly onCancel: () => void
}

/**
 * The status sheet (SPEC 14, "Your status"; inventory 2.1b), as Slack's
 * status dialog: the emoji button and the text, Slack's presets while the
 * text is empty, Clear after, then Clear status (when you have one),
 * Cancel and Save, which waits for an emoji or text. The text field takes
 * focus as the sheet opens. ↓ from the empty field moves through the
 * presets and Enter picks one; a picked preset puts focus back in the
 * field, the caret at the end. The emoji button opens the emoji picker as
 * a popover under it; Escape there closes only the picker and focus goes
 * back to the button. Enter in the text saves; Escape closes (the
 * container's `SheetLayer`).
 */
export function StatusSheet<V extends string>(props: StatusSheetProps<V>) {
  const { emoji, text, presets, clearAfterOptions, clearAfter, hasStatus, busy = false, picker, onClosePicker, onPreset, onClearAfterChange, onSave, onClearStatus, onCancel } = props
  const empty = text.trim() === '' && emoji === undefined
  const showPresets = text === '' && emoji === undefined
  const anchorRef = useRef<HTMLSpanElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  usePickerFocus(anchorRef, pickerRef, picker !== undefined, onClosePicker)
  const { fieldRef, listId, active, setActive, presetId, pick, onFieldKey } = usePresetKeys(presets, showPresets, onPreset)
  // Under the field's frame (its label), as wide as it.
  const fieldBox = useCallback(() => fieldRef.current?.closest('label') ?? null, [fieldRef])
  usePickerPlace(anchorRef, pickerRef, picker !== undefined, fieldBox)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!busy && !empty) onSave()
  }
  return (
    <>
      <Surface kind="popover" as="section" role="dialog" aria-label="Set a status" aria-modal data-status-sheet="" padding="none" sx={styles.sheet}>
        <form onSubmit={submit} {...stylex.props(styles.inner)}>
          <Text variant="heading" tone="default" as="h2">
            Set a status
          </Text>
          <StatusField
            {...props}
            empty={empty}
            fieldRef={fieldRef}
            anchorRef={anchorRef}
            {...(showPresets ? { listId, activeId: active } : {})}
            onKeyDown={onFieldKey}
          />
          {showPresets ? <Presets presets={presets} listId={listId} active={active} presetId={presetId} onActive={setActive} onPick={pick} /> : null}
          <ClearAfter options={clearAfterOptions} value={clearAfter} disabled={empty} onChange={onClearAfterChange} />
          <div {...stylex.props(styles.buttons)}>
            {hasStatus ? (
              <Button type="button" variant="ghost" tone="subtle" size="md" disabled={busy} onClick={onClearStatus}>
                Clear status
              </Button>
            ) : null}
            <span {...stylex.props(styles.spacer)} />
            <Button type="button" variant="secondary" size="md" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={busy || empty}>
              Save
            </Button>
          </div>
        </form>
      </Surface>
      {picker === undefined ? null : (
        <div ref={pickerRef} data-status-picker="" {...stylex.props(styles.picker)}>
          {picker}
        </div>
      )}
    </>
  )
}

/**
 * The field and the presets: the field takes focus once the sheet is in
 * (the avatar menu hands focus back to its button as it closes), ↓ and ↑
 * from the empty field move a highlight through the presets, Enter picks
 * the highlighted one, and a pick puts focus back in the field with the
 * caret at the end.
 */
function usePresetKeys<V extends string>(presets: ReadonlyArray<StatusSheetPreset<V>>, showPresets: boolean, onPreset: (preset: StatusSheetPreset<V>) => void) {
  const fieldRef = useRef<HTMLInputElement>(null)
  const caretToEnd = useRef(false)
  const listId = useId()
  const [active, setActive] = useState<string | undefined>(undefined)
  useEffect(() => {
    fieldRef.current?.focus()
  }, [])
  useLayoutEffect(() => {
    const field = fieldRef.current
    if (!caretToEnd.current || field === null) return
    caretToEnd.current = false
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  })
  const presetId = (preset: StatusSheetPreset<V>) => `${listId}-${preset.emoji.name}`
  const pick = (preset: StatusSheetPreset<V>) => {
    caretToEnd.current = true
    setActive(undefined)
    onPreset(preset)
  }
  const keys = useOptionListKeys({
    ids: showPresets ? presets.map(presetId) : [],
    activeId: active,
    onActiveChange: setActive,
    onSelect: (id) => {
      const preset = presets.find((each) => presetId(each) === id)
      if (preset !== undefined) pick(preset)
    },
  })
  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter saves unless a preset is highlighted.
    if (showPresets && !(event.key === 'Enter' && active === undefined)) keys(event)
  }
  return { fieldRef, listId, active, setActive, presetId, pick, onFieldKey }
}

/** Slack's presets: each row's emoji and text under the field's, with the Clear after it sets at the end. */
function Presets<V extends string>({ presets, listId, active, presetId, onActive, onPick }: {
  readonly presets: ReadonlyArray<StatusSheetPreset<V>>
  readonly listId: string
  readonly active: string | undefined
  readonly presetId: (preset: StatusSheetPreset<V>) => string
  readonly onActive: (id: string) => void
  readonly onPick: (preset: StatusSheetPreset<V>) => void
}) {
  return (
    <div {...stylex.props(styles.presets)}>
      <OptionList id={listId} label="Presets" activeId={active}>
        {presets.map((preset) => (
          <OptionRow
            key={preset.text}
            id={presetId(preset)}
            size={30}
            active={active === presetId(preset)}
            leading={
              <span {...stylex.props(styles.presetEmoji)}>
                <EmojiFace emoji={preset.emoji} size={16} />
              </span>
            }
            label={preset.text}
            sub={preset.clearAfterLabel}
            onActivate={() => onActive(presetId(preset))}
            onSelect={() => onPick(preset)}
          />
        ))}
      </OptionList>
    </div>
  )
}

/** "Clear after" and its choices, as the field's height. */
function ClearAfter<V extends string>({ options, value, disabled, onChange }: { readonly options: ReadonlyArray<{ readonly value: V; readonly label: string }>; readonly value: V; readonly disabled: boolean; readonly onChange: (value: V) => void }) {
  return (
    <div {...stylex.props(styles.clearAfter)}>
      <Text variant="meta" tone="muted" weight="medium" as="span" aria-hidden>
        Clear after
      </Text>
      <Select
        label="Clear after"
        size={32}
        options={options}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const chosen = options.find((option) => option.value === event.currentTarget.value)
          if (chosen !== undefined) onChange(chosen.value)
        }}
      />
    </div>
  )
}

interface FieldProps<V extends string> extends StatusSheetProps<V> {
  readonly empty: boolean
  readonly fieldRef: RefObject<HTMLInputElement | null>
  readonly anchorRef: RefObject<HTMLSpanElement | null>
  /** The presets' list while it shows, and its highlighted row. */
  readonly listId?: string
  readonly activeId?: string | undefined
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}

/** The emoji button, the text with its clear button, and Slack's refusal under them. */
function StatusField<V extends string>({ emoji, textEmoji, text, maxLength, error, empty, picker, fieldRef, anchorRef, listId, activeId, onEmoji, onTextChange, onClearField, onKeyDown }: FieldProps<V>) {
  const shown = emoji ?? (text.trim() === '' ? undefined : textEmoji)
  return (
    <div {...stylex.props(styles.field)}>
      <TextField
        ref={fieldRef}
        size={32}
        label="Status"
        placeholder="What’s your status?"
        value={text}
        maxLength={maxLength}
        autoComplete="off"
        {...(listId === undefined ? {} : { 'aria-controls': listId, 'aria-activedescendant': activeId })}
        leading={
          <span ref={anchorRef} {...stylex.props(styles.anchor)}>
            {shown === undefined ? (
              <IconButton icon={SmileyPlus} label="Choose an emoji" size={24} variant="ghost" tone="muted" expanded={picker !== undefined} onClick={onEmoji} />
            ) : (
              <button
                type="button"
                aria-label={`Emoji: ${shown.name}. Choose another`}
                aria-expanded={picker !== undefined}
                data-status-emoji={shown.name}
                onClick={onEmoji}
                {...stylex.props(styles.emojiButton, focusRing.outside)}
              >
                <EmojiFace emoji={shown} size={16} />
              </button>
            )}
          </span>
        }
        trailing={empty ? undefined : <IconButton icon={X} label="Clear" size={24} variant="ghost" tone="muted" onClick={onClearField} />}
        invalid={error !== undefined}
        onChange={(event) => onTextChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {error === undefined ? null : (
        <Text variant="meta" tone="danger" as="span" role="alert">
          {error}
        </Text>
      )}
    </div>
  )
}

const styles = stylex.create({
  sheet: {
    width: '100%',
    maxWidth: layout['--status-sheet-width'],
    boxSizing: 'border-box',
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    paddingBlock: spacing['--space-4'],
    paddingInline: spacing['--space-5'],
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
  },
  anchor: {
    display: 'inline-flex',
    flexShrink: 0,
  },
  emojiButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--control-24'],
    height: sizes['--control-24'],
    padding: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-sm'],
    cursor: 'default',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, '@media (hover: hover)': colors['--secondary-hover'] },
      ':active': { default: colors['--secondary-active'], '@media (hover: hover)': colors['--secondary-active'] },
    },
  },
  // The rows' emoji and text sit under the field's emoji button and text: the field's border and inset, less the row's own.
  presets: {
    paddingInline: spacing['--space-1'],
  },
  presetEmoji: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--icon-20'],
  },
  clearAfter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-3'],
  },
  buttons: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    paddingTop: spacing['--space-1'],
  },
  spacer: {
    flex: 1,
  },
  // Over the sheet, which is a popover too: the hairline gives it an edge in dark, where the shadow does not show
  // against the sheet. Its width comes from the field (`usePickerPlace`).
  picker: {
    position: 'fixed',
    top: 0,
    left: 0,
    zIndex: z['--z-picker'],
    borderRadius: radii['--radius-menu'],
    outlineWidth: '1px',
    outlineStyle: 'solid',
    outlineOffset: '-1px', // tokens-allow: the hairline drawn on the picker's own edge
    outlineColor: colors['--border-strong'],
  },





})

import * as stylex from '@stylexjs/stylex'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { FormEvent } from 'react'
import type { StatusEmoji } from '@juno/contract'
import { layout, radii, sizes, spacing, colors } from '@juno/tokens/tokens.stylex'
import { Button, Emoji, focusRing, IconButton, OptionList, OptionRow, Select, SmileyPlus, Surface, Text, TextField } from '@juno/ui'

export interface StatusSheetPreset {
  readonly emoji: StatusEmoji
  readonly text: string
  /** "1 hour", "Today", "Don’t clear": what choosing it sets Clear after to. */
  readonly clearAfter: string
}

export interface StatusSheetProps {
  /** The chosen emoji; none until one is picked or a preset fills it. */
  readonly emoji?: StatusEmoji | undefined
  readonly text: string
  /** Slack's limit, in characters. */
  readonly maxLength: number
  /** Slack's presets, shown while the field is empty. */
  readonly presets: ReadonlyArray<StatusSheetPreset>
  /** The Clear after choices; an existing status that clears later adds its own time first. */
  readonly clearAfterOptions: ReadonlyArray<{ readonly value: string; readonly label: string }>
  readonly clearAfter: string
  /** You have a status now: Clear status shows. */
  readonly hasStatus: boolean
  /** Save or Clear status is waiting for Slack. */
  readonly busy?: boolean
  /** Why the last try failed, in plain words. */
  readonly error?: string | undefined
  readonly onEmoji: () => void
  readonly onTextChange: (text: string) => void
  /** The field's clear button: the text and the emoji go. */
  readonly onClearField: () => void
  readonly onPreset: (preset: StatusSheetPreset) => void
  readonly onClearAfterChange: (value: string) => void
  readonly onSave: () => void
  readonly onClearStatus: () => void
  readonly onCancel: () => void
}

/**
 * The status sheet (SPEC 14, "Your status"; inventory 2.1b), as Slack's
 * status dialog: the emoji button and the text, Slack's presets while the
 * text is empty, Clear after, then Clear status (when you have one),
 * Cancel and Save, which waits for an emoji or text. The emoji button opens the emoji picker, which the
 * container shows in the sheet's place. Enter in the text saves; Escape
 * closes (the container's `SheetLayer`).
 */
export function StatusSheet(props: StatusSheetProps) {
  const { emoji, text, presets, clearAfterOptions, clearAfter, hasStatus, busy = false, onPreset, onClearAfterChange, onSave, onClearStatus, onCancel } = props
  const empty = text.trim() === '' && emoji === undefined
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!busy && !empty) onSave()
  }
  return (
    <Surface kind="popover" as="section" role="dialog" aria-label="Set a status" aria-modal data-status-sheet="" padding="none" sx={styles.sheet}>
      <form onSubmit={submit} {...stylex.props(styles.inner)}>
        <Text variant="heading" tone="default" as="h2">
          Set a status
        </Text>
        <StatusField {...props} empty={empty} />
        {text === '' && emoji === undefined ? <Presets presets={presets} onPreset={onPreset} /> : null}
        <div {...stylex.props(styles.clearAfter)}>
          <Text variant="meta" tone="muted" weight="medium" as="span" aria-hidden>
            Clear after
          </Text>
          <Select label="Clear after" size={30} options={clearAfterOptions} value={clearAfter} disabled={empty} onChange={(event) => onClearAfterChange(event.currentTarget.value)} />
        </div>
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
  )
}

/** The emoji button, the text with its clear button, and Slack's refusal under them. */
function StatusField({ emoji, text, maxLength, error, empty, onEmoji, onTextChange, onClearField }: StatusSheetProps & { readonly empty: boolean }) {
  return (
    <div {...stylex.props(styles.field)}>
      <TextField
        size={32}
        label="Status"
        placeholder="What’s your status?"
        value={text}
        maxLength={maxLength}
        autoFocus
        autoComplete="off"
        leading={
          emoji === undefined ? (
            <IconButton icon={SmileyPlus} label="Choose an emoji" size={24} variant="ghost" tone="muted" onClick={onEmoji} />
          ) : (
            <button type="button" aria-label={`Emoji: ${emoji.name}. Choose another`} data-status-emoji={emoji.name} onClick={onEmoji} {...stylex.props(styles.emojiButton, focusRing.outside)}>
              <EmojiFace emoji={emoji} size={16} />
            </button>
          )
        }
        trailing={empty ? undefined : <IconButton icon={X} label="Clear" size={24} variant="ghost" tone="muted" onClick={onClearField} />}
        invalid={error !== undefined}
        onChange={(event) => onTextChange(event.currentTarget.value)}
      />
      {error === undefined ? null : (
        <Text variant="meta" tone="danger" as="span" role="alert">
          {error}
        </Text>
      )}
    </div>
  )
}

/** Slack's presets: each fills the emoji, the text and Clear after. */
function Presets({ presets, onPreset }: Pick<StatusSheetProps, 'presets' | 'onPreset'>) {
  return (
    <OptionList label="Presets">
      {presets.map((preset) => (
        <OptionRow
          key={preset.text}
          id={`status-preset-${preset.emoji.name}`}
          size={30}
          leading={<EmojiFace emoji={preset.emoji} size={16} />}
          label={preset.text}
          sub={preset.clearAfter}
          subPlacement="inline"
          onSelect={() => onPreset(preset)}
        />
      ))}
    </OptionList>
  )
}

/** A status emoji: the standard emoji's text, a custom one's image, or its name when the workspace no longer has it. */
export function EmojiFace({ emoji, size }: { readonly emoji: StatusEmoji; readonly size: 14 | 16 | 20 }) {
  if (emoji.unicode !== undefined) return <Emoji glyph={emoji.unicode} size={size} />
  if (emoji.url !== undefined) return <Emoji url={emoji.url} size={size} />
  return (
    <Text variant="meta" tone="muted" as="span">
      :{emoji.name}:
    </Text>
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
  statusLine: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  statusText: {
    overflowWrap: 'anywhere',
  },
  until: {
    color: colors['--foreground-muted'],
  },
})

/**
 * A person's status in their avatar's tooltip (SPEC 7, "People"): the
 * emoji and the text, then when it clears.
 */
export function StatusLine({ emoji, text, until }: { readonly emoji?: StatusEmoji | undefined; readonly text: string; readonly until?: string | undefined }) {
  return (
    <span data-person-status="" {...stylex.props(styles.statusLine)}>
      {emoji === undefined ? null : <EmojiFace emoji={emoji} size={14} />}
      <span {...stylex.props(styles.statusText)}>
        {text}
        {until === undefined ? null : <span {...stylex.props(styles.until)}>{` · ${until}`}</span>}
      </span>
    </span>
  )
}

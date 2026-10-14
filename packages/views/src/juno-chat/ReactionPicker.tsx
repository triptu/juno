import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { chatCopy, isEmoji } from '@juno/agent-contract'
import { colors, radii, spacing } from '@juno/tokens/tokens.stylex'
import { EmojiButton, TextField } from '@juno/ui'

export interface ReactionPickerProps {
  /** The owner's reaction on this item now, if any. Picking it again removes it. */
  readonly selected?: string
  /** An emoji, or `null` to remove the owner's reaction. */
  readonly onPick: (emoji: string | null) => void
  /** Focus the field when the picker opens from the keyboard. */
  readonly autoFocus?: boolean
}

/** A few to pick at once. Any other emoji goes in the field, where the system emoji picker also works. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '✅', '😮'] as const

/**
 * The reaction picker (SPEC 13.1), the panel the container shows in a
 * popover at a bubble's or card's React button. Any emoji: a row of quick
 * ones, and a field that takes exactly one emoji on Enter.
 */
export function ReactionPicker({ selected, onPick, autoFocus = false }: ReactionPickerProps) {
  const [draft, setDraft] = useState('')
  const pick = (emoji: string) => onPick(emoji === selected ? null : emoji)
  const typed = draft.trim()
  return (
    <div role="group" aria-label={chatCopy.react.picker} data-reaction-picker="" {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.row)}>
        {QUICK_REACTIONS.map((emoji) => (
          <span key={emoji} {...stylex.props(styles.cell, emoji === selected && styles.selected)}>
            <EmojiButton emoji={emoji} label={chatCopy.react.reacted(emoji)} aria-pressed={emoji === selected} onClick={() => pick(emoji)} />
          </span>
        ))}
      </div>
      <TextField
        size={30}
        text="ui"
        label={chatCopy.react.anyEmoji}
        placeholder={chatCopy.react.anyEmoji}
        value={draft}
        autoFocus={autoFocus}
        invalid={typed !== '' && !isEmoji(typed)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && isEmoji(typed)) {
            event.preventDefault()
            pick(typed)
          }
        }}
      />
    </div>
  )
}

const styles = stylex.create({
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-0-5'],
  },
  cell: {
    display: 'inline-flex',
    borderRadius: radii['--radius-xl'],
  },
  // The owner's current reaction: a quiet fill behind it; picking it again removes it.
  selected: {
    backgroundColor: colors['--surface-active'],
  },
})

import * as stylex from '@stylexjs/stylex'
import { ArrowUp } from '@phosphor-icons/react/dist/icons/ArrowUp'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { IconButton, Surface, Textarea } from '@juno/ui'

export interface ComposerProps {
  /** The draft is the owner's: controlled. */
  readonly value: string
  readonly onChange: (value: string) => void
  /** Enter, or the send button. Called with an empty draft too: the owner decides (New chat opens the picker). */
  readonly onSend: () => void
  /** "Message", "Message #eng", "Reply". */
  readonly placeholder: string
  /** A send is in flight: the field stays editable, the button does not send twice. */
  readonly sending?: boolean
  /** Above the field, inside its column: New chat's pickers. */
  readonly above?: ReactNode
  readonly inputRef?: Ref<HTMLTextAreaElement>
  /** ↑ in an empty field: a topic selects its newest message (SPEC section 7, Keyboard). */
  readonly onArrowUpEmpty?: () => void
  /** Inside the box, above the text: the audience warning and the send check bar (inventory 7). */
  readonly notices?: ReactNode
  /** Esc in the field, while there is something to close (the send check bar). */
  readonly onEscape?: () => void
  /**
   * Before the text: the attach button, once attachments exist (inventory 7).
   * Nothing is passed until then, so the composer shows no control that does nothing.
   */
  readonly leading?: ReactNode
}

/**
 * The composer (inventory 7): a 752px field whose textarea grows to 194px,
 * and the round send button, dimmed while there is nothing to send. Enter
 * sends, Shift Enter adds a line. At one line it has the `ComposerSlot`'s
 * geometry, so one replaces the other with no shift. The text starts 18px in,
 * as in the Juno composer; `leading` is where the attach button goes.
 * `notices` grow the box upwards; the text row stays where it is.
 */
export function Composer({ value, onChange, onSend, placeholder, sending = false, above, inputRef, onArrowUpEmpty, leading, notices, onEscape }: ComposerProps) {
  const empty = value.trim().length === 0
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'ArrowUp' && value === '' && onArrowUpEmpty !== undefined && !event.shiftKey && !event.metaKey && !event.altKey && !event.ctrlKey) {
      event.preventDefault()
      onArrowUpEmpty()
      return
    }
    if (event.key === 'Escape' && onEscape !== undefined && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onEscape()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!sending) onSend()
  }
  return (
    <div data-composer="" {...stylex.props(styles.outer)}>
      {above !== undefined ? <div {...stylex.props(styles.above)}>{above}</div> : null}
      <Surface kind="field" data-composer-field="" sx={styles.box}>
        {notices}
        <div {...stylex.props(styles.row, leading !== undefined && styles.rowWithLeading)}>
          {leading}
          <Textarea
            ref={inputRef}
            variant="inline"
            maxHeight="composer"
            label={placeholder}
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            dir="auto"
          />
          <span {...stylex.props(styles.send)}>
            <IconButton
              icon={ArrowUp}
              label="Send"
              size={28}
              iconSize={16}
              iconWeight="bold"
              radius="full"
              variant="primary"
              dimmed={empty || sending}
              onClick={() => {
                if (!sending) onSend()
              }}
            />
          </span>
        </div>
      </Surface>
    </div>
  )
}

const styles = stylex.create({
  outer: {
    flexShrink: 0,
    width: '100%',
    paddingTop: spacing['--space-2'],
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-5'],
    boxSizing: 'border-box',
  },
  above: {
    display: 'flex',
    width: '100%',
    maxWidth: layout['--composer-width'],
    marginInline: 'auto',
    marginBottom: spacing['--space-2'],
  },
  box: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: layout['--composer-width'],
    marginInline: 'auto',
    boxSizing: 'border-box',
  },
  // The row is 40px at one line (the textarea's 9 + 22 + 9). It reaches into the field's 1px border,
  // so the field is 40px tall too, like the ComposerSlot it replaces.
  row: {
    display: 'flex',
    alignItems: 'flex-end',
    minWidth: 0,
    // The padding is the row's, not the box's, so the notices above it span the box.
    paddingInlineStart: spacing['--space-3-5'],
    paddingInlineEnd: spacing['--space-1-5'],
    gap: spacing['--space-1'],
    marginBlock: '-1px',
  },
  // A 28px leading control sits 6px in, as the send button does at the end.
  rowWithLeading: {
    paddingInlineStart: spacing['--space-1-5'],
  },
  send: {
    display: 'inline-flex',
    flexShrink: 0,
    paddingBlock: spacing['--space-1-5'],
  },
})

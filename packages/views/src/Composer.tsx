import * as stylex from '@stylexjs/stylex'
import { ArrowUp } from '@phosphor-icons/react/dist/icons/ArrowUp'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { colors, layout, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Icon, IconButton, Surface, Textarea } from '@juno/ui'

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
}

/**
 * The composer (inventory 7): a 752px field whose textarea grows to 194px,
 * the attach mark, and the round send button, dimmed while there is nothing
 * to send. Enter sends, Shift Enter adds a line. At one line it has the
 * `ComposerSlot`'s geometry, so one replaces the other with no shift.
 * Attachments come with M6: the attach mark is drawn, not a button.
 */
export function Composer({ value, onChange, onSend, placeholder, sending = false, above, inputRef }: ComposerProps) {
  const empty = value.trim().length === 0
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!sending) onSend()
  }
  return (
    <div data-composer="" {...stylex.props(styles.outer)}>
      {above !== undefined ? <div {...stylex.props(styles.above)}>{above}</div> : null}
      <Surface kind="field" data-composer-field="" sx={styles.box}>
        <div {...stylex.props(styles.row)}>
          <span aria-hidden {...stylex.props(styles.mark, styles.attach)}>
            <Icon icon={Plus} size={18} />
          </span>
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
    width: '100%',
    maxWidth: layout['--composer-width'],
    marginInline: 'auto',
    paddingInline: spacing['--space-1-5'],
    boxSizing: 'border-box',
  },
  // The row is 40px at one line (the textarea's 9 + 22 + 9). It reaches into the field's 1px border,
  // so the field is 40px tall too, like the ComposerSlot it replaces.
  row: {
    display: 'flex',
    alignItems: 'flex-end',
    flexGrow: 1,
    minWidth: 0,
    gap: spacing['--space-1'],
    marginBlock: '-1px',
  },
  mark: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-28'],
    height: sizes['--control-28'],
    marginBlock: spacing['--space-1-5'],
    borderRadius: radii['--radius-full'],
  },
  attach: {
    color: colors['--foreground-subtle'],
  },
  send: {
    display: 'inline-flex',
    flexShrink: 0,
    paddingBlock: spacing['--space-1-5'],
  },
})

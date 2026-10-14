import * as stylex from '@stylexjs/stylex'
import { ArrowUp } from '@phosphor-icons/react/dist/icons/ArrowUp'
import type { KeyboardEvent, Ref } from 'react'
import { chatCopy } from '@juno/agent-contract'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { IconButton, Surface, Textarea } from '@juno/ui'

export interface JunoComposerProps {
  /** The draft is the renderer's: controlled. */
  readonly value: string
  readonly onChange: (value: string) => void
  /** Enter, or the send button, with a non-empty draft. Sending during a run is allowed: it queues. */
  readonly onSend: () => void
  /** Esc with the composer empty: Stop the current run (SPEC 13.2). */
  readonly onEscape?: () => void
  /** False only for AI off, Update needed and Another device. */
  readonly enabled: boolean
  /** The job's state line in place of the placeholder (the home's Ask Juno field). */
  readonly placeholder?: string
  /** The textarea, for ⌘J to focus it. */
  readonly inputRef?: Ref<HTMLTextAreaElement>
}

/**
 * The chat composer (inventory 12): a 672px field, the textarea growing to
 * 160px, and the round send button, dimmed while the draft is empty and
 * never disabled by a run. Enter sends, Shift Enter adds a line.
 */
export function JunoComposer({ value, onChange, onSend, onEscape, enabled, placeholder = chatCopy.composer.placeholder, inputRef }: JunoComposerProps) {
  const canSend = enabled && value.trim().length > 0
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (canSend) onSend()
    } else if (event.key === 'Escape' && value.length === 0) {
      onEscape?.()
    }
  }
  return (
    <div data-juno-composer="" {...stylex.props(styles.outer)}>
      <Surface kind="field" sx={styles.box}>
        <Textarea
          ref={inputRef}
          variant="inline"
          maxHeight="assistant"
          label={chatCopy.composer.placeholder}
          placeholder={placeholder}
          value={value}
          disabled={!enabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          dir="auto"
        />
        <span {...stylex.props(styles.send)}>
          <IconButton icon={ArrowUp} label={chatCopy.composer.send} size={28} iconSize={18} iconWeight="bold" radius="full" variant="primary" dimmed={!canSend} onClick={() => canSend && onSend()} />
        </span>
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
  box: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: spacing['--space-1'],
    width: '100%',
    maxWidth: `calc(${layout['--page-width']} - ${spacing['--space-12']})`,
    marginInline: 'auto',
    paddingInlineStart: spacing['--space-3-5'],
    paddingInlineEnd: spacing['--space-1-5'],
    boxSizing: 'border-box',
  },
  send: {
    display: 'inline-flex',
    flexShrink: 0,
    paddingBlock: spacing['--space-1-5'],
  },
})

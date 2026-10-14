import * as stylex from '@stylexjs/stylex'
import { ArrowUp } from '@phosphor-icons/react/dist/icons/ArrowUp'
import type { KeyboardEvent, Ref } from 'react'
import { chatCopy, type Quote } from '@juno/agent-contract'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { IconButton, Surface, Textarea } from '@juno/ui'
import { QuoteStub } from './QuoteStub'

export interface JunoComposerProps {
  /** The draft is the renderer's: controlled. */
  readonly value: string
  readonly onChange: (value: string) => void
  /** Enter, or the send button, with a non-empty draft. Sending while Juno works is like any send: it joins at the next step. */
  readonly onSend: () => void
  /** Esc with the composer empty and no quote: the Juno panel closes (SPEC, Juno panel). Never a Stop. */
  readonly onEscape?: () => void
  /** The bubble or card this message replies to, shown above the field. */
  readonly quote?: Quote
  /** The quote's close button, or Esc while a quote is attached. */
  readonly onClearQuote?: () => void
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
export function JunoComposer({ value, onChange, onSend, onEscape, quote, onClearQuote, enabled, placeholder = chatCopy.composer.placeholder, inputRef }: JunoComposerProps) {
  const canSend = enabled && value.trim().length > 0
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (canSend) onSend()
    } else if (event.key === 'Escape' && quote !== undefined && onClearQuote !== undefined) {
      onClearQuote()
    } else if (event.key === 'Escape' && value.length === 0) {
      onEscape?.()
    }
  }
  return (
    <div data-juno-composer="" {...stylex.props(styles.outer)}>
      {quote !== undefined ? (
        <div data-composer-quote="" {...stylex.props(styles.quote)}>
          <QuoteStub quote={quote} {...(onClearQuote ? { onClear: onClearQuote } : {})} />
        </div>
      ) : null}
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
  // Above the field, lined up with its text.
  quote: {
    display: 'flex',
    maxWidth: `calc(${layout['--page-width']} - ${spacing['--space-12']})`,
    marginInline: 'auto',
    marginBottom: spacing['--space-1-5'],
    paddingInline: spacing['--space-3-5'],
    boxSizing: 'border-box',
  },
  send: {
    display: 'inline-flex',
    flexShrink: 0,
    paddingBlock: spacing['--space-1-5'],
  },
})

import * as stylex from '@stylexjs/stylex'
import { ArrowUp } from '@phosphor-icons/react/dist/icons/ArrowUp'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { chatCopy, type Quote } from '@juno/agent-contract'
import { layout, opacity, spacing } from '@juno/tokens/tokens.stylex'
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
  /** `panel`: the Juno panel's padding, full width. Default `page`. */
  readonly column?: 'page' | 'panel'
  /** Above the field in the panel: the selection quote, the About chip, Catch me up. */
  readonly context?: ReactNode
}

/**
 * The chat composer (inventory 12): a 40px field on the chat column's edges,
 * the textarea growing to 160px, and the round send button, dimmed while the
 * draft is empty and never disabled by a run. Enter sends, Shift Enter adds a line.
 */
export function JunoComposer({ value, onChange, onSend, onEscape, quote, onClearQuote, enabled, placeholder = chatCopy.composer.placeholder, inputRef, column = 'page', context }: JunoComposerProps) {
  const panel = column === 'panel'
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
    <div data-juno-composer={column} {...stylex.props(styles.outer, panel && styles.outerPanel)}>
      {context}
      {quote !== undefined ? (
        <div data-composer-quote="" {...stylex.props(styles.quote, panel && styles.wide)}>
          <QuoteStub quote={quote} {...(onClearQuote ? { onClear: onClearQuote } : {})} />
        </div>
      ) : null}
      <Surface kind="field" sx={[styles.box, panel && styles.wide, !enabled && styles.off]}>
        <div {...stylex.props(styles.row)}>
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
            <IconButton icon={ArrowUp} label={chatCopy.composer.send} size={28} iconSize={16} iconWeight="bold" radius="full" variant="primary" dimmed={!canSend} onClick={() => canSend && onSend()} />
          </span>
        </div>
      </Surface>
    </div>
  )
}

const styles = stylex.create({
  // Disabled (AI off, update needed, another device): dimmed like any disabled control, so it does not invite typing.
  off: {
    opacity: opacity['--opacity-disabled'],
  },
  outer: {
    flexShrink: 0,
    width: '100%',
    paddingTop: spacing['--space-2'],
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-5'],
    boxSizing: 'border-box',
  },
  // The bottom inset is the topic composer's, so the two fields end on one line when the panel sits beside a topic.
  outerPanel: {
    paddingTop: 0,
    paddingInline: spacing['--space-3'],
  },
  wide: {
    maxWidth: 'none',
  },
  // The chat column's width less its 32px padding each side, so the field lines up with the bubbles and the header island.
  box: {
    display: 'flex',
    width: '100%',
    maxWidth: `calc(${layout['--page-width']} - ${spacing['--space-16']})`,
    marginInline: 'auto',
    paddingInlineStart: spacing['--space-3-5'],
    paddingInlineEnd: spacing['--space-1-5'],
    boxSizing: 'border-box',
  },
  // Above the field, lined up with its text.
  quote: {
    display: 'flex',
    maxWidth: `calc(${layout['--page-width']} - ${spacing['--space-16']})`,
    marginInline: 'auto',
    marginBottom: spacing['--space-1-5'],
    paddingInline: spacing['--space-3-5'],
    boxSizing: 'border-box',
  },
  // 40px at one line (the textarea's 9 + 22 + 9): the row reaches into the field's 1px border, as the topic composer's does.
  row: {
    display: 'flex',
    alignItems: 'flex-end',
    flexGrow: 1,
    minWidth: 0,
    gap: spacing['--space-1'],
    marginBlock: '-1px',
  },
  send: {
    display: 'inline-flex',
    flexShrink: 0,
    paddingBlock: spacing['--space-1-5'],
  },
})

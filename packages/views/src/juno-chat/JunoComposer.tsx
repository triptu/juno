import * as stylex from '@stylexjs/stylex'
import { ArrowUp } from '@phosphor-icons/react/dist/icons/ArrowUp'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { chatCopy, type Quote } from '@juno/agent-contract'
import { layout, opacity, spacing } from '@juno/tokens/tokens.stylex'
import { IconButton, Surface, Textarea, type TextareaMark } from '@juno/ui'
import { mentionProps, transfers, type ComposerMention } from '../Composer'
import { QuoteStub } from './QuoteStub'

export interface JunoComposerProps {
  /** The draft is the renderer's: controlled. */
  readonly value: string
  readonly onChange: (value: string, caret: number) => void
  /** The picked people and channels, drawn as chips over their names, as in the topic composer. */
  readonly marks?: ReadonlyArray<TextareaMark>
  readonly mention?: ComposerMention
  readonly onFieldKey?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
  readonly onCaret?: (caret: number) => void
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
  /** In the field's top, above the text, in the panel: the context chips. */
  readonly context?: ReactNode
  /** Before the text: the attach button (`AttachButton`), as in the topic composer. */
  readonly leading?: ReactNode
  /** The chips of the files going to Juno, inside the field above the text, and any line about them (`AttachmentNote`). */
  readonly attachments?: ReactNode
  /** Files pasted into the field or dropped on the composer. */
  readonly onFiles?: (files: ReadonlyArray<File>) => void
  /** Files Juno will take are attached: Enter sends with no text too. */
  readonly hasFiles?: boolean
}

/**
 * The chat composer (inventory 12): a 40px field on the chat column's edges,
 * the textarea growing to 160px, and the round send button, dimmed while the
 * draft is empty and never disabled by a run. Enter sends, Shift Enter adds a line.
 */
export function JunoComposer({ value, onChange, onSend, onEscape, quote, onClearQuote, enabled, placeholder = chatCopy.composer.placeholder, inputRef, column = 'page', context, marks = NO_MARKS, mention, onFieldKey, onCaret, leading, attachments, onFiles, hasFiles = false }: JunoComposerProps) {
  const panel = column === 'panel'
  const canSend = enabled && (value.trim().length > 0 || hasFiles)
  const files = transfers(enabled ? onFiles : undefined, undefined)
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (onFieldKey?.(event) === true) return
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
    <div
      data-juno-composer={column}
      onDragOver={onFiles === undefined || !enabled ? undefined : files.onDragOver}
      onDrop={onFiles === undefined || !enabled ? undefined : files.onDrop}
      {...stylex.props(styles.outer, panel && styles.outerPanel)}
    >
      {quote !== undefined ? (
        <div data-composer-quote="" {...stylex.props(styles.quote, panel && styles.wide)}>
          <QuoteStub quote={quote} {...(onClearQuote ? { onClear: onClearQuote } : {})} />
        </div>
      ) : null}
      <Surface kind="field" data-composer-field="" sx={[styles.box, leading !== undefined && styles.boxWithLeading, panel && styles.wide, !enabled && styles.off]}>
        {context !== undefined && leading !== undefined ? <div {...stylex.props(styles.contextWithLeading)}>{context}</div> : context}
        {attachments !== undefined ? <div {...stylex.props(styles.attachments)}>{attachments}</div> : null}
        <div {...stylex.props(styles.row)}>
          {leading}
          <Textarea
            ref={inputRef}
            variant="inline"
            maxHeight="assistant"
            label={chatCopy.composer.placeholder}
            placeholder={placeholder}
            value={value}
            disabled={!enabled}
            onChange={(event) => onChange(event.currentTarget.value, event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            {...mentionProps(marks, mention, onCaret)}
            onPaste={onFiles === undefined || !enabled ? undefined : files.onPaste}
            dir="auto"
          />
          <span {...stylex.props(styles.send)}>
            <IconButton icon={ArrowUp} label={chatCopy.composer.send} size={28} iconSize={16} iconWeight="bold" radius="full" variant="primary" dimmed={!canSend} onClick={() => canSend && onSend()} />
          </span>
        </div>
      </Surface>
      {mention?.list}
    </div>
  )
}

const NO_MARKS: ReadonlyArray<TextareaMark> = []

const styles = stylex.create({
  // Disabled (AI off, update needed, another device): dimmed like any disabled control, so it does not invite typing.
  off: {
    opacity: opacity['--opacity-disabled'],
  },
  outer: {
    position: 'relative',
    anchorScope: 'all',
    flexShrink: 0,
    width: '100%',
    paddingTop: spacing['--space-2'],
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-5'],
    boxSizing: 'border-box',
  },
  // With the panel's 8px inset under it, the topic composer's 20px bottom inset, so the two fields end on one line.
  outerPanel: {
    paddingTop: 0,
    paddingInline: spacing['--space-3'],
    paddingBottom: spacing['--space-3'],
  },
  wide: {
    maxWidth: 'none',
  },
  // The topic composer's width (SPEC 12): a question sent from Home opens this tab with the field where Home's was.
  box: {
    anchorName: '--composer-box',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: layout['--composer-width'],
    marginInline: 'auto',
    paddingInlineStart: spacing['--space-3-5'],
    paddingInlineEnd: spacing['--space-1-5'],
    boxSizing: 'border-box',
  },
  // Above the field, lined up with its text.
  quote: {
    display: 'flex',
    maxWidth: layout['--composer-width'],
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
    marginBlock: '-1px', // tokens-allow: Overlap the composer border by one pixel.
  },
  // A 28px leading control sits 6px in, as the send button does at the end; the context chips keep their place.
  boxWithLeading: {
    paddingInlineStart: spacing['--space-1-5'],
  },
  contextWithLeading: {
    paddingInlineStart: spacing['--space-2'],
  },
  // Over the text: the chips start 6px in, under the attach button, as in the topic composer.
  attachments: {
    display: 'flex',
    paddingTop: spacing['--space-1-5'],
    minWidth: 0,
  },
  send: {
    display: 'inline-flex',
    flexShrink: 0,
    paddingBlock: spacing['--space-1-5'],
  },
})

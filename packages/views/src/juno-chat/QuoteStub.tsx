import * as stylex from '@stylexjs/stylex'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { chatCopy, type Quote } from '@juno/agent-contract'
import { accent, colors, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { IconButton, Text } from '@juno/ui'

export interface QuoteStubProps {
  readonly quote: Quote
  /** Above a sent bubble: a click scrolls to the original. */
  readonly onOpen?: () => void
  /** In the composer: the close button removes the quote. */
  readonly onClear?: () => void
}

/**
 * The one-line quote of a reply (SPEC 13.1): who said it and the first
 * line, behind a thin bar. Above a bubble it is a button that scrolls to
 * the original; above the composer it has a close button. A removed target
 * reads "Removed". Always one line, so it never changes height.
 */
export function QuoteStub({ quote, onOpen, onClear }: QuoteStubProps) {
  const from = quote.target._tag === 'owner' ? chatCopy.react.you : chatCopy.react.juno
  const line = (
    <Text variant="meta" tone="muted" truncate dir="auto">
      <Text variant="meta" weight="medium" tone="subtle" as="span">
        {from}
      </Text>
      {' · '}
      {quote.removed ? chatCopy.react.removed : quote.preview}
    </Text>
  )
  return (
    <div data-quote={quote.target._tag} data-quote-removed={quote.removed || undefined} {...stylex.props(styles.stub)}>
      <span aria-hidden {...stylex.props(styles.bar)} />
      {onOpen === undefined ? (
        <span {...stylex.props(styles.line)}>{line}</span>
      ) : (
        <button type="button" onClick={onOpen} {...stylex.props(styles.line, styles.button)}>
          {line}
        </button>
      )}
      {onClear === undefined ? null : <IconButton icon={X} label={chatCopy.react.clearQuote} size={20} radius="sm" iconSize={12} tone="muted" onClick={onClear} />}
    </div>
  )
}

const styles = stylex.create({
  stub: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
    maxWidth: '100%',
    minHeight: sizes['--control-22'],
    userSelect: 'none',
  },
  bar: {
    flexShrink: 0,
    alignSelf: 'stretch',
    width: spacing['--space-0-5'],
    backgroundColor: colors['--border-strong'],
  },
  line: {
    display: 'flex',
    minWidth: 0,
    flexShrink: 1,
    textAlign: 'start',
  },
  button: {
    appearance: 'none',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    font: 'inherit',
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
  },
})

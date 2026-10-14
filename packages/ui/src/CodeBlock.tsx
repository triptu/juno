import * as stylex from '@stylexjs/stylex'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { variants as typeVariants } from './internal/type'
import { Surface } from './Surface'

export interface CodeBlockProps {
  readonly children: string
  readonly label?: string
  /**
   * Cap the height at `--code-block-max-height` and scroll inside. For a
   * block in a card. A block in a message is laid out in full, so a reader
   * scrolls past it like any other message and the wheel is never trapped.
   */
  readonly scroll?: boolean
}

/** A selectable mono block on the page background. */
export function CodeBlock({ children, label, scroll = false }: CodeBlockProps) {
  return (
    <Surface kind="inset" as="pre" aria-label={label} sx={[styles.block, scroll && styles.scroll]}>
      <code {...stylex.props(typeVariants.code, styles.code)}>{children}</code>
    </Surface>
  )
}

const styles = stylex.create({
  block: {
    margin: 0,
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-3'],
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
    cursor: 'text',
  },
  // Inline content hands the wheel back at its edges; contained overscroll
  // is for overlays.
  scroll: {
    maxHeight: layout['--code-block-max-height'],
    overflowY: 'auto',
  },
  code: {
    display: 'block',
    color: colors['--foreground-default'],
  },
})

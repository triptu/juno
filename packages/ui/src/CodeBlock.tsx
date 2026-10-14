import * as stylex from '@stylexjs/stylex'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { variants as typeVariants } from './internal/type'
import { Surface } from './Surface'

export interface CodeBlockProps {
  readonly children: string
  readonly label?: string
}

/**
 * A selectable mono block on the page background. A long one scrolls inside
 * a capped box; at its edges the wheel goes on to the page, as it does for
 * any inline content (contained overscroll is for overlays).
 */
export function CodeBlock({ children, label }: CodeBlockProps) {
  return (
    <Surface kind="inset" as="pre" aria-label={label} sx={styles.block}>
      <code {...stylex.props(typeVariants.code, styles.code)}>{children}</code>
    </Surface>
  )
}

const styles = stylex.create({
  block: {
    margin: 0,
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-3'],
    maxHeight: layout['--code-block-max-height'],
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
    cursor: 'text',
  },
  code: {
    display: 'block',
    color: colors['--foreground-default'],
  },
})

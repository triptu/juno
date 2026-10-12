import * as stylex from '@stylexjs/stylex'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { roles } from './internal/type'
import { Surface } from './Surface'

export interface CodeBlockProps {
  readonly children: string
  readonly label?: string
}

/** A selectable, scrolling mono block on the page background. */
export function CodeBlock({ children, label }: CodeBlockProps) {
  return (
    <Surface kind="inset" as="pre" aria-label={label} sx={styles.block}>
      <code {...stylex.props(roles.code, styles.code)}>{children}</code>
    </Surface>
  )
}

const styles = stylex.create({
  block: {
    margin: 0,
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-3'],
    maxHeight: '150px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
    cursor: 'text',
    color: colors['--foreground-default'],
  },
  code: {
    display: 'block',
  },
})

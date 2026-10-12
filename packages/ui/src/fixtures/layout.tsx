import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'

/** Lays fixture samples out in a wrapping row. */
export function Row({ children, gap = 'md' }: { readonly children: ReactNode; readonly gap?: 'sm' | 'md' | 'lg' }) {
  return <div {...stylex.props(styles.row, gaps[gap])}>{children}</div>
}

/** Stacks fixture samples vertically. */
export function Stack({ children, gap = 'md', width }: { readonly children: ReactNode; readonly gap?: 'sm' | 'md' | 'lg'; readonly width?: number }) {
  return <div {...stylex.props(styles.stack, gaps[gap], width !== undefined && styles.width(width))}>{children}</div>
}

const styles = stylex.create({
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  width: (px: number) => ({ width: px }),
})

const gaps = stylex.create({
  sm: { gap: spacing['--space-1-5'] },
  md: { gap: spacing['--space-3'] },
  lg: { gap: spacing['--space-5'] },
})

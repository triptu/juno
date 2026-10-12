import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, fonts, type } from '@juno/tokens/tokens.stylex'

export interface PageTitleProps {
  readonly children: ReactNode
}

/**
 * The serif page title used for "All topics", "For you", "Notifications" and
 * similar pages. Instrument Serif only has a 400 weight, so never ask for bold.
 */
export function PageTitle({ children }: PageTitleProps) {
  return <h1 {...stylex.props(styles.title)}>{children}</h1>
}

const styles = stylex.create({
  title: {
    margin: 0,
    fontFamily: fonts['--font-serif'],
    fontSize: type['--text-3xl'],
    fontWeight: 400,
    lineHeight: type['--leading-tight'],
    letterSpacing: 0,
    color: colors['--foreground-default'],
    userSelect: 'none',
  },
})

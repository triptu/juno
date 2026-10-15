import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from './Text'

export type PageWidth = 'narrow' | 'default' | 'settings'

export interface PageProps {
  /** narrow 680, default 720, settings 760 (every section of Settings). */
  readonly width?: PageWidth
  readonly children?: ReactNode
}

/** A scrolling page with a centred column of a fixed maximum width. */
export function Page({ width = 'default', children }: PageProps) {
  return (
    <div {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.column, widths[width], styles.page)}>{children}</div>
    </div>
  )
}

export interface PageHeaderProps {
  readonly title: string
  /** `compact` is the 32px All topics title. */
  readonly size?: 'default' | 'compact'
  readonly subtitle?: ReactNode
  /** Right-aligned content such as a search field. */
  readonly trailing?: ReactNode
}

/** Serif page title, optional subtitle and a trailing slot. */
export function PageHeader({ title, size = 'default', subtitle, trailing }: PageHeaderProps) {
  return (
    <header {...stylex.props(styles.header)}>
      <div {...stylex.props(styles.headerText)}>
        <Text variant={size === 'compact' ? 'pageTitleCompact' : 'pageTitle'} tone="default">
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text variant="body" tone="subtle" as="p" sx={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </div>
      {trailing ? <div {...stylex.props(styles.trailing)}>{trailing}</div> : null}
    </header>
  )
}

export interface SectionProps {
  readonly heading: string
  readonly sub?: string
  readonly children?: ReactNode
}

/** A settings section: heading, one-line explanation, then a group card. */
export function Section({ heading, sub, children }: SectionProps) {
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionHead)}>
        <Text variant="heading" tone="default">
          {heading}
        </Text>
        {sub ? (
          <Text variant="ui" tone="muted" as="p">
            {sub}
          </Text>
        ) : null}
      </div>
      {children}
    </section>
  )
}

const styles = stylex.create({
  scroll: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    // The scrollbar's room is kept whether or not the page overflows, so a page
    // that grows past the window (Settings › Juno once the agent's part arrives)
    // does not move its centred column sideways.
    scrollbarGutter: 'stable',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-9'],
    width: '100%',
    marginInline: 'auto',
    boxSizing: 'border-box',
  },
  page: {
    paddingBlock: `${spacing['--space-10']} ${spacing['--space-18']}`,
    paddingInline: spacing['--space-8'],
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing['--space-4'],
    userSelect: 'none',
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  subtitle: {
    maxWidth: '62ch',
    textWrap: 'pretty',
  },
  trailing: {
    flexShrink: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
  },
  sectionHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    userSelect: 'none',
  },
})

const widths = stylex.create({
  narrow: { maxWidth: layout['--page-width-narrow'] },
  default: { maxWidth: layout['--page-width'] },
  settings: { maxWidth: layout['--page-width-settings'] },
})

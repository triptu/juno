import * as stylex from '@stylexjs/stylex'
import { createContext, useContext, type ReactNode, type Ref } from 'react'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { revealFocus } from './internal/revealFocus'
import { Text } from './Text'

export type PageWidth = 'narrow' | 'default' | 'settings'

export interface PageProps {
  /** narrow 680, default 720, settings 760 (every section of Settings). */
  readonly width?: PageWidth
  readonly children?: ReactNode
}

/**
 * A scrolling page with a centred column of a fixed maximum width. Keyboard
 * focus inside it scrolls into view whole, ring included.
 */
export function Page({ width = 'default', children }: PageProps) {
  const underHeader = useContext(PageUnderHeader)
  return (
    <div onFocus={revealFocus} data-under-header={underHeader ? '' : undefined} {...stylex.props(styles.scroll, underHeader && styles.scrollUnderHeader)}>
      <div {...stylex.props(styles.column, widths[width], styles.page, underHeader && styles.pageUnderHeader)}>{children}</div>
    </div>
  )
}

/**
 * Set by a frame that lays a header's islands over its page (the Juno
 * pages, under the Juno header): the page scrolls under the band, starts
 * below the islands, and its scrollbar track starts below the band, as a
 * list does with `ScrollArea underHeader`.
 */
export const PageUnderHeader = createContext(false)

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
  /** A quiet control at the end of the heading's line (a ghost `xs` button such as Add). It never makes the line taller. */
  readonly action?: ReactNode
  /** The heading's element, for a page that scrolls to the section and focuses it. */
  readonly headingRef?: Ref<HTMLElement>
  readonly children?: ReactNode
}

/** A settings section: heading, one-line explanation, then a group card. */
export function Section({ heading, sub, action, headingRef, children }: SectionProps) {
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionHead)}>
        {action === undefined ? (
          <Text variant="heading" tone="default" ref={headingRef}>
            {heading}
          </Text>
        ) : (
          <div {...stylex.props(styles.headingLine)}>
            <Text variant="heading" tone="default" ref={headingRef}>
              {heading}
            </Text>
            <div {...stylex.props(styles.action)}>{action}</div>
          </div>
        )}
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

// A page this narrow (Settings beside its rail at the minimum window is 296) keeps 16px on each side, not 32.
const NARROW = '@container page (width < 400px)'

const styles = stylex.create({
  // Stretched, so its width never comes from its content: the column's padding narrows by a container query on it.
  scroll: {
    flexGrow: 1,
    alignSelf: 'stretch',
    containerType: 'inline-size',
    containerName: 'page',
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
    paddingInline: { default: spacing['--space-8'], [NARROW]: spacing['--space-4'] },
  },
  scrollUnderHeader: {
    paddingTop: layout['--header-inset'],
    scrollPaddingTop: layout['--header-band'],
  },
  // The islands already sit above it: a smaller gap than the page's own top.
  pageUnderHeader: {
    paddingBlockStart: spacing['--space-4'],
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
  headingLine: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-3'],
    minWidth: 0,
  },
  // No height of its own: the control centres on the heading's line and
  // overhangs it, so a section with an action is as tall as one without.
  action: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    height: 0,
  },
})

const widths = stylex.create({
  narrow: { maxWidth: layout['--page-width-narrow'] },
  default: { maxWidth: layout['--page-width'] },
  settings: { maxWidth: layout['--page-width-settings'] },
})

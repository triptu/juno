import * as stylex from '@stylexjs/stylex'
import type { KeyboardEvent, ReactNode } from 'react'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { revealFocus } from './internal/revealFocus'

export interface TabStripProps {
  readonly label?: string
  /**
   * Controls before the tabs, after the traffic lights' space: Show
   * sidebar, Back and Forward while the sidebar is hidden.
   */
  readonly leading?: ReactNode
  /**
   * The new-tab button, right after the last tab as in Safari and Chrome.
   * It sits outside the scroller, so when the tabs overflow it stays at the
   * strip's end and never scrolls away.
   */
  readonly trailing?: ReactNode
  /**
   * Keys pressed on a tab that the strip does not handle itself: the owner
   * moves the selection on ArrowLeft, ArrowRight, Home and End (the APG
   * tablist pattern with automatic activation). Delete closes the tab.
   */
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  readonly children?: ReactNode
}

/**
 * The 44px strip above the workspace. A window drag region. The tabs sit in
 * a horizontal scroller with no visible scrollbar, as wide as the tabs need
 * and no wider, so `trailing` follows the last tab and the rest of the
 * strip is free to drag the window by. The active tab scrolls itself into
 * view when it changes, like browser tabs, and a tab that takes keyboard
 * focus scrolls into view whole. Tabs draw the inset ring, so the strip
 * needs no room around them.
 */
export function TabStrip({ label = 'Tabs', leading, trailing, onKeyDown, children }: TabStripProps) {
  return (
    <div data-tab-strip="" {...stylex.props(styles.strip, leading !== undefined && styles.stripLeading)}>
      {leading !== undefined ? <span {...stylex.props(styles.leading)}>{leading}</span> : null}
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} onFocus={revealFocus} {...stylex.props(styles.scroller)}>
        {children}
      </div>
      {trailing ? (
        <span data-tab-strip-trailing="" {...stylex.props(styles.trailing)}>
          {trailing}
        </span>
      ) : null}
    </div>
  )
}

const styles = stylex.create({
  strip: {
    display: 'flex',
    alignItems: 'flex-end',
    // Fills the window so the strip and its bottom border run edge to edge,
    // and never gives up height to a tall page under it.
    width: '100%',
    flexShrink: 0,
    boxSizing: 'border-box',
    height: layout['--titlebar-height'],
    paddingInline: spacing['--space-2-5'],
    backgroundColor: colors['--background-subtle'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
    userSelect: 'none',
    WebkitAppRegion: 'drag',
  },
  // With the sidebar hidden the strip starts after the traffic lights.
  stripLeading: {
    paddingInlineStart: layout['--titlebar-lights-inset'],
  },
  leading: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
    flexShrink: 0,
    alignSelf: 'center',
    marginInlineEnd: spacing['--space-2'],
    WebkitAppRegion: 'no-drag',
  },
  // The tabs scroll sideways inside the strip. The scroller hangs 1px over
  // the strip's bottom border so the active tab can paint across it. It
  // takes only the tabs' width, and shrinks to scroll once they overflow.
  scroller: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: spacing['--space-0-5'],
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    height: '100%',
    marginBottom: '-1px', // tokens-allow: Overlap the page border by one pixel.
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollbarWidth: 'none',
    scrollSnapType: 'x proximity',
    overscrollBehaviorX: 'contain',
  },
  // A square slot as tall as a tab and level with it, one tab gap after the
  // last tab: the button inside is centred on the tabs' middle line and
  // keeps an even inset on all four sides.
  trailing: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'flex-end',
    width: layout['--tab-height'],
    height: layout['--tab-height'],
    marginBottom: '-1px', // tokens-allow: Level with the tabs, which overlap the page border by one pixel.
    marginInlineStart: spacing['--space-0-5'],
    WebkitAppRegion: 'no-drag',
  },
})

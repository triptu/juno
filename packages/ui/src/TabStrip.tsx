import * as stylex from '@stylexjs/stylex'
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { revealFocus } from './internal/revealFocus'
import type { TabDrag } from './internal/tabDrag'

// The drag code is not needed to paint the strip, so it loads after startup (performance 1, the bundle budget): when the strip is idle, or on the first press.
let tabDragModule: Promise<typeof import('./internal/tabDrag')> | undefined
const loadTabDrag = () => (tabDragModule ??= import('./internal/tabDrag'))

export interface TabStripProps {
  readonly label?: string
  /**
   * Controls before the tabs, after the traffic lights' space: Show
   * sidebar, Back and Forward while the sidebar is hidden.
   */
  readonly leading?: ReactNode
  /**
   * The window is in full screen, where macOS hides the traffic lights:
   * `leading` starts at the strip's own padding instead of after their space.
   */
  readonly fullScreen?: boolean
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
  /**
   * A tab was dragged from index `from` to index `to`, within its pinned or
   * unpinned group. Without it the tabs do not drag.
   */
  readonly onMove?: (from: number, to: number) => void
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
 *
 * With `onMove`, a tab drags along the strip to a new place, as in Safari
 * (`internal/tabDrag.ts`): transforms only, written once a frame, and no tab
 * re-renders until the drop.
 */
export function TabStrip({ label = 'Tabs', leading, fullScreen = false, trailing, onKeyDown, onMove, children }: TabStripProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const drag = useRef<TabDrag | undefined>(undefined)
  const move = useRef(onMove)
  const movable = onMove !== undefined
  // A drop asked for a new order; this commit shows it, so the dragged tabs' transforms go before paint.
  useLayoutEffect(() => {
    move.current = onMove
    drag.current?.settled()
  })
  // Makes the strip's drag once its code has loaded. Returns it, or undefined once the strip has stopped dragging.
  const ensure = useRef<() => Promise<TabDrag | undefined>>(async () => undefined)
  useEffect(() => {
    const element = scroller.current
    if (!movable || element === null) return
    let stopped = false
    ensure.current = async () => {
      const { TabDrag } = await loadTabDrag()
      if (stopped) return undefined
      drag.current ??= new TabDrag(element, { onMove: (from, to) => move.current?.(from, to) })
      return drag.current
    }
    const idle = requestIdleCallback(() => void ensure.current(), { timeout: 5_000 })
    return () => {
      stopped = true
      cancelIdleCallback(idle)
      drag.current?.dispose()
      drag.current = undefined
    }
  }, [movable])
  // A press before the code has loaded still drags: the press is passed on once it has.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const press = event.nativeEvent
    if (drag.current !== undefined) {
      drag.current.pointerDown(press)
      return
    }
    // A press released while the code loads was a click, not a drag.
    let released = false
    const release = () => (released = true)
    window.addEventListener('pointerup', release, { once: true, capture: true })
    void ensure.current().then((ready) => {
      window.removeEventListener('pointerup', release, { capture: true })
      if (!released) ready?.pointerDown(press)
    })
  }
  return (
    <div data-tab-strip="" {...stylex.props(styles.strip, leading !== undefined && !fullScreen && styles.stripLeading)}>
      {leading !== undefined ? <span {...stylex.props(styles.leading)}>{leading}</span> : null}
      <div ref={scroller} role="tablist" aria-label={label} onKeyDown={onKeyDown} onFocus={revealFocus} onPointerDown={movable ? onPointerDown : undefined} {...stylex.props(styles.scroller)}>
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
    backgroundColor: colors['--tab-strip'],
    // The strip's own buttons ("+", and Back and Forward with the sidebar
    // hidden) hover with the tabs' fill; the usual one is the strip's.
    '--surface-hover': colors['--tab-hover'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
    userSelect: 'none',
    WebkitAppRegion: 'drag',
  },
  // With the sidebar hidden the strip starts after the traffic lights, except in full screen, which has none.
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
  // Tabs touch, as in Safari and Finder; dividers separate inactive ones.
  // Positioned, so each tab's offsetLeft is measured from it when a drag starts.
  scroller: {
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-end',
    gap: 0,
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

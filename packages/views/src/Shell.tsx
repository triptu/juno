import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { SIDEBAR_WIDTH } from '@juno/contract/channels'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { ResizeEdge } from './ResizeEdge'

export interface ShellProps {
  /** The left pane. Without one (signed out) the page fills the window under a drag strip. */
  readonly sidebar?: ReactNode
  /** The sidebar's width in CSS pixels, 312 to 480. Default 384. */
  readonly sidebarWidth?: number
  /** Hidden: the sidebar keeps its state but takes no space (spec section 4). */
  readonly sidebarHidden?: boolean
  /** A drag on the sidebar's edge ended at `width`. */
  readonly onSidebarResize?: (width: number) => void
  /** A double-click on the sidebar's edge. */
  readonly onSidebarResetWidth?: () => void
  /** A drag on the edge ended far enough left to hide the sidebar. */
  readonly onSidebarCollapse?: () => void
  /** The peek popover (`PeekView`), while one is open. It hangs off the sidebar's right edge. */
  readonly peek?: ReactNode
  /** The toast (bottom-left of the window), over both panes. */
  readonly toast?: ReactNode
  /** Over the whole window, while one is open: the ⌘K palette. */
  readonly overlay?: ReactNode
  readonly children?: ReactNode
}

/** A drag that ends with the sidebar narrower than this hides it (inventory 1). */
const COLLAPSE_BELOW = 200

/**
 * The window frame (spec section 4). Signed in: the sidebar on the left and
 * the workspace on the right, each with its own 44px drag bar. Signed out:
 * one drag strip over a page. It paints with no data; everything that
 * waits on the engine renders its own waiting state inside. Nothing above
 * the panes may change on a tick (performance 4.3).
 */
export function Shell({ sidebar, sidebarWidth = SIDEBAR_WIDTH.default, sidebarHidden = false, onSidebarResize, onSidebarResetWidth, onSidebarCollapse, peek, toast, overlay, children }: ShellProps) {
  const slot = useRef<HTMLDivElement>(null)
  // The width is set on the sidebar's own box, here and by a drag, never
  // through React state, so a drag re-renders nothing. It is a plain width,
  // not an inherited custom property, so a change restyles one element and
  // not every element below it.
  useLayoutEffect(() => {
    if (slot.current !== null) slot.current.style.width = `${sidebarWidth}px`
  }, [sidebarWidth])
  if (sidebar !== undefined) {
    return (
      <div {...stylex.props(styles.shell, styles.panes)}>
        <div ref={slot} {...stylex.props(styles.sidebarSlot, sidebarHidden && styles.hidden)}>
          {sidebar}
          <ResizeEdge width={sidebarWidth} min={SIDEBAR_WIDTH.min} max={SIDEBAR_WIDTH.max} label="Resize sidebar" onResize={onSidebarResize} onReset={onSidebarResetWidth} collapseBelow={COLLAPSE_BELOW} onCollapse={onSidebarCollapse} />
          {peek}
        </div>
        {children}
        {toast}
        {overlay}
      </div>
    )
  }
  return (
    <div {...stylex.props(styles.shell, styles.column)}>
      <header {...stylex.props(styles.titlebar)} aria-label="Window title bar" />
      <main {...stylex.props(styles.page)}>{children}</main>
    </div>
  )
}

const styles = stylex.create({
  shell: {
    // The toast region is placed against the window.
    position: 'relative',
    // The peek beside the sidebar reads the window's width as `100cqw`.
    containerName: 'shell',
    containerType: 'inline-size',
    display: 'flex',
    width: '100%',
    height: '100%',
    // Clips sideways without being a scroll container: a hidden box still scrolls when something in it takes
    // focus or asks to be shown, and the whole window would move sideways. The shell never scrolls. Only the x
    // axis clips: a box that clips both axes at the window's edge cuts Chromium's lazy-image margin, so a photo
    // just below the fold in the sidebar or a topic never loads until it is scrolled to. Nothing hangs below the
    // shell, since a popover is capped at the room on its side of the anchor.
    overflowX: 'clip',
    overflowY: 'visible',
    backgroundColor: colors['--background'],
    color: colors['--foreground-default'],
  },
  panes: {
    flexDirection: 'row',
  },
  // Holds the sidebar at the width set on it, and the edge.
  sidebarSlot: {
    position: 'relative',
    display: 'flex',
    flexShrink: 0,
    width: layout['--sidebar-width'],
    height: '100%',
  },
  hidden: {
    display: 'none',
  },
  column: {
    flexDirection: 'column',
  },
  titlebar: {
    flexShrink: 0,
    height: layout['--titlebar-height'],
    // The strip is draggable; interactive children must set no-drag.
    WebkitAppRegion: 'drag',
    userSelect: 'none',
  },
  page: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-4'],
    paddingInline: spacing['--space-8'],
    paddingBlock: spacing['--space-4'],
    backgroundColor: colors['--background'],
  },
})

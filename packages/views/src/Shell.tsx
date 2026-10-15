import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, type PointerEvent, type ReactNode } from 'react'
import { SIDEBAR_WIDTH } from '@juno/contract/channels'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'

export interface ShellProps {
  /** The left pane. Without one (signed out) the page fills the window under a drag strip. */
  readonly sidebar?: ReactNode
  /** The sidebar's width in CSS pixels, 280 to 480. Default 384. */
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
          <SidebarEdge width={sidebarWidth} onResize={onSidebarResize} onReset={onSidebarResetWidth} onCollapse={onSidebarCollapse} />
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

interface SidebarEdgeProps {
  readonly width: number
  readonly onResize: ((width: number) => void) | undefined
  readonly onReset: (() => void) | undefined
  readonly onCollapse: (() => void) | undefined
}

function write(box: HTMLElement, width: number): void {
  box.style.width = `${width}px`
}

const clamp = (width: number) => Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)))

/**
 * The sidebar's resize edge: a 6px hit area centred on its border. A drag
 * writes the sidebar's width at most once per frame and
 * reports it when it ends; a double-click asks for the default.
 */
function SidebarEdge({ width, onResize, onReset, onCollapse }: SidebarEdgeProps) {
  /** The drag in progress, with the sidebar's box: the edge's parent. */
  const drag = useRef<{ readonly box: HTMLElement; readonly startX: number; raw: number; frame: number | undefined } | undefined>(undefined)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const box = event.currentTarget.parentElement
    if (box === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { box, startX: event.clientX, raw: width, frame: undefined }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current === undefined) return
    current.raw = width + event.clientX - current.startX
    if (current.frame !== undefined) return
    current.frame = requestAnimationFrame(() => {
      current.frame = undefined
      write(current.box, clamp(current.raw))
    })
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current === undefined) return
    drag.current = undefined
    if (current.frame !== undefined) cancelAnimationFrame(current.frame)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (event.type === 'pointerup' && current.raw < COLLAPSE_BELOW) {
      write(current.box, width)
      onCollapse?.()
      return
    }
    const next = event.type === 'pointerup' ? clamp(current.raw) : width
    write(current.box, next)
    if (next !== width) onResize?.(next)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={width}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      {...stylex.props(styles.edge)}
    />
  )
}

const styles = stylex.create({
  shell: {
    // The toast region is placed against the window.
    position: 'relative',
    display: 'flex',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
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
  // Centred on the sidebar's border, over both panes, and above the title bars' drag regions.
  edge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: `calc(${layout['--sidebar-resize-hit']} / -2)`,
    width: layout['--sidebar-resize-hit'],
    zIndex: 1,
    cursor: 'col-resize',
    touchAction: 'none',
    WebkitAppRegion: 'no-drag',
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

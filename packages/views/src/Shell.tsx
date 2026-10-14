import * as stylex from '@stylexjs/stylex'
import { useLayoutEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react'
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
export function Shell({ sidebar, sidebarWidth = SIDEBAR_WIDTH.default, sidebarHidden = false, onSidebarResize, onSidebarResetWidth, onSidebarCollapse, children }: ShellProps) {
  const shell = useRef<HTMLDivElement>(null)
  // The width is a CSS variable on the shell, set here and by a drag, never
  // through React state, so a drag re-renders nothing.
  useLayoutEffect(() => {
    shell.current?.style.setProperty('--sidebar-width', `${sidebarWidth}px`)
  }, [sidebarWidth])
  if (sidebar !== undefined) {
    return (
      <div ref={shell} {...stylex.props(styles.shell, styles.panes)}>
        <div {...stylex.props(styles.sidebarSlot, sidebarHidden && styles.hidden)}>{sidebar}</div>
        {sidebarHidden ? null : (
          <SidebarEdge shell={shell} width={sidebarWidth} onResize={onSidebarResize} onReset={onSidebarResetWidth} onCollapse={onSidebarCollapse} />
        )}
        {children}
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
  readonly shell: RefObject<HTMLDivElement | null>
  readonly width: number
  readonly onResize: ((width: number) => void) | undefined
  readonly onReset: (() => void) | undefined
  readonly onCollapse: (() => void) | undefined
}

const clamp = (width: number) => Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)))

/**
 * The sidebar's resize edge: a 6px hit area centred on its border. A drag
 * writes the width to the shell's variable at most once per frame and
 * reports it when it ends; a double-click asks for the default.
 */
function SidebarEdge({ shell, width, onResize, onReset, onCollapse }: SidebarEdgeProps) {
  const drag = useRef<{ readonly startX: number; raw: number; frame: number | undefined } | undefined>(undefined)

  const write = (value: number) => shell.current?.style.setProperty('--sidebar-width', `${value}px`)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, raw: width, frame: undefined }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current === undefined) return
    current.raw = width + event.clientX - current.startX
    current.frame ??= requestAnimationFrame(() => {
      current.frame = undefined
      write(clamp(current.raw))
    })
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current === undefined) return
    drag.current = undefined
    if (current.frame !== undefined) cancelAnimationFrame(current.frame)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (event.type === 'pointerup' && current.raw < COLLAPSE_BELOW) {
      write(width)
      onCollapse?.()
      return
    }
    const next = clamp(current.raw)
    write(next)
    if (event.type === 'pointerup' && next !== width) onResize?.(next)
    else if (event.type !== 'pointerup') write(width)
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
    display: 'flex',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: colors['--background'],
    color: colors['--foreground-default'],
  },
  panes: {
    position: 'relative',
    flexDirection: 'row',
  },
  sidebarSlot: {
    display: 'flex',
    flexShrink: 0,
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
    left: `calc(${layout['--sidebar-width']} - ${layout['--sidebar-resize-hit']} / 2)`,
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

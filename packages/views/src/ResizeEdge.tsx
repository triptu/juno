/**
 * A pane's resize edge (SPEC 4): a 6px hit area centred on the pane's
 * right border. A drag writes the pane's width at most once a frame,
 * straight onto the pane (its parent), with no React state, and reports the
 * width when it ends; a double-click asks for the default. With
 * `collapseBelow`, a drag that ends narrower than that hides the pane
 * instead. It is a window splitter for the keyboard too: Tab reaches it,
 * ← and → move it 8px, Home and End go to the minimum and the maximum, and
 * Enter asks for the default. The sidebar uses it on its right edge, and
 * the Search tab's topic panel on its left (`side="start"`), where a drag
 * to the left and ← widen it.
 */
import * as stylex from '@stylexjs/stylex'
import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { layout } from '@juno/tokens/tokens.stylex'
import { focusRing } from '@juno/ui'

/** The pane's width, written straight onto its box. */
const write = (box: HTMLElement, next: number) => {
  box.style.width = `${next}px`
}

/** How far ← and → move the edge. */
const KEY_STEP = 8

export interface ResizeEdgeProps {
  readonly width: number
  readonly min: number
  readonly max: number
  /** "Resize sidebar". */
  readonly label: string
  readonly onResize: ((width: number) => void) | undefined
  readonly onReset: (() => void) | undefined
  readonly collapseBelow?: number
  readonly onCollapse?: (() => void) | undefined
  /** Which edge of the pane: its right (`end`, the default) or its left. */
  readonly side?: 'start' | 'end'
}

export function ResizeEdge({ width, min, max, label, onResize, onReset, collapseBelow, onCollapse, side = 'end' }: ResizeEdgeProps) {
  /** A move to the right widens a pane whose right edge this is, and narrows one whose left edge it is. */
  const sign: 1 | -1 = side === 'end' ? 1 : -1
  /** The drag in progress, with the pane's box: the edge's parent. */
  const drag = useRef<{ readonly box: HTMLElement; readonly startX: number; raw: number; frame: number | undefined } | undefined>(undefined)
  const clamp = (raw: number) => Math.round(Math.min(max, Math.max(min, raw)))
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
    current.raw = width + sign * (event.clientX - current.startX)
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
    // Where the button came up decides, even when the last moves before it were not delivered.
    if (event.type === 'pointerup') current.raw = width + sign * (event.clientX - current.startX)
    if (event.type === 'pointerup' && collapseBelow !== undefined && current.raw < collapseBelow) {
      write(current.box, width)
      onCollapse?.()
      return
    }
    const next = event.type === 'pointerup' ? clamp(current.raw) : width
    write(current.box, next)
    if (next !== width) onResize?.(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Enter') {
      event.preventDefault()
      return onReset?.()
    }
    const to = keyedWidth(event.key, width, min, max, sign)
    if (to === undefined) return
    event.preventDefault()
    const box = event.currentTarget.parentElement
    const next = clamp(to)
    if (box === null || next === width) return
    write(box, next)
    onResize?.(next)
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      data-resize-edge=""
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      {...stylex.props(styles.edge, side === 'start' && styles.start, focusRing.inset)}
    />
  )
}

/** Where ←, →, Home and End move the edge to; undefined for any other key. */
function keyedWidth(key: string, width: number, min: number, max: number, sign: 1 | -1): number | undefined {
  if (key === 'ArrowLeft') return width - sign * KEY_STEP
  if (key === 'ArrowRight') return width + sign * KEY_STEP
  return key === 'Home' ? min : key === 'End' ? max : undefined
}

const styles = stylex.create({
  // Centred on the pane's border, over both sides, and above the title bars' drag regions.
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
  start: {
    right: 'auto',
    left: `calc(${layout['--sidebar-resize-hit']} / -2)`,
  },
})

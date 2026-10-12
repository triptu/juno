import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, type ReactNode } from 'react'
import { layout, spacing, z } from '@juno/tokens/tokens.stylex'
import { Surface, type SurfacePadding, type SurfaceRadius } from './Surface'

export type PopoverPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'
export type PopoverLayer = 'mention' | 'picker' | 'menu' | 'context'
export type PopoverWidth = 'menu' | 'account' | 'browse' | 'mention' | 'anchor'

export interface PopoverProps {
  readonly open: boolean
  /** Called on Esc, on a click outside, and when focus leaves. */
  readonly onClose: () => void
  /** The element the panel hangs off. Rendered in place. */
  readonly anchor: ReactNode
  readonly placement?: PopoverPlacement
  /** Named width from the layout tokens, or `anchor` to match the anchor. */
  readonly width?: PopoverWidth
  readonly maxHeight?: 'popover' | 'picker' | 'none'
  readonly layer?: PopoverLayer
  readonly radius?: SurfaceRadius
  readonly padding?: SurfacePadding
  /** ARIA role of the panel. Default `dialog`. */
  readonly role?: 'dialog' | 'listbox' | 'menu'
  readonly label?: string
  /** Keep open while a pointer is down inside an input that owns it. */
  readonly closeOnBlur?: boolean
  readonly children?: ReactNode
}

/**
 * Floats a popover Surface next to its anchor. No enter or exit animation.
 * Scrolling is contained so the page behind never moves.
 */
export function Popover({
  open,
  onClose,
  anchor,
  placement = 'bottom-end',
  width = 'menu',
  maxHeight = 'popover',
  layer = 'menu',
  radius = 'menu',
  padding = 'sm',
  role = 'dialog',
  label,
  closeOnBlur = true,
  children,
}: PopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (root && event.target instanceof Node && !root.contains(event.target)) onClose()
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!closeOnBlur) return
      const root = rootRef.current
      if (root && event.target instanceof Node && !root.contains(event.target)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [open, onClose, closeOnBlur])

  return (
    <div ref={rootRef} {...stylex.props(styles.root)}>
      {anchor}
      {open ? (
        <div {...stylex.props(styles.panel, placements[placement], widths[width], layers[layer])}>
          <Surface
            kind="popover"
            radius={radius}
            padding={padding}
            role={role}
            aria-label={label}
            sx={[styles.surface, maxHeights[maxHeight]]}
          >
            {children}
          </Surface>
        </div>
      ) : null}
    </div>
  )
}

const styles = stylex.create({
  root: {
    position: 'relative',
    display: 'inline-flex',
    minWidth: 0,
  },
  panel: {
    position: 'absolute',
  },
  surface: {
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
})

const placements = stylex.create({
  'bottom-start': { top: `calc(100% + ${spacing['--space-1']})`, left: 0 },
  'bottom-end': { top: `calc(100% + ${spacing['--space-1']})`, right: 0 },
  'top-start': { bottom: `calc(100% + ${spacing['--space-1-5']})`, left: 0 },
  'top-end': { bottom: `calc(100% + ${spacing['--space-1-5']})`, right: 0 },
})

const widths = stylex.create({
  menu: { width: layout['--menu-width'] },
  account: { width: layout['--menu-width-account'] },
  browse: { width: layout['--menu-width-browse'] },
  mention: { width: layout['--menu-width-mention'] },
  anchor: { left: 0, right: 0 },
})

const maxHeights = stylex.create({
  popover: { maxHeight: layout['--popover-max-height'] },
  picker: { maxHeight: layout['--picker-max-height'] },
  none: {},
})

const layers = stylex.create({
  mention: { zIndex: z['--z-mention'] },
  picker: { zIndex: z['--z-picker'] },
  menu: { zIndex: z['--z-menu'] },
  context: { zIndex: z['--z-context'] },
})

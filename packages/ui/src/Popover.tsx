import * as stylex from '@stylexjs/stylex'
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { layout, spacing, z } from '@juno/tokens/tokens.stylex'
import { Surface, type SurfacePadding, type SurfaceRadius } from './Surface'

export type PopoverPlacement = 'bottom-start' | 'bottom-center' | 'bottom-end' | 'top-start' | 'top-end'
export type PopoverLayer = 'mention' | 'picker' | 'menu' | 'context'
export type PopoverWidth = 'menu' | 'account' | 'browse' | 'mention' | 'picker' | 'anchor'

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
  /** Where focus goes back after Escape, as a selector inside the anchor: for an anchor with several controls. Default its first focusable. */
  readonly returnFocusTo?: string
  /**
   * A start placement whose anchor is wider than the control that opens it (the header's left island):
   * a selector inside the anchor, and the panel's left edge goes on that element's left edge.
   * The panel still hangs below or above the whole anchor.
   */
  readonly alignTo?: string
  readonly children?: ReactNode
}

/** The gap kept between a clamped panel and the edge of its pane. */
const EDGE_GAP = '--space-2'

/** The nearest ancestor that clips its overflow (the pane), or undefined for the window. */
function clipOf(node: HTMLElement): HTMLElement | undefined {
  for (let el = node.parentElement; el !== null && el !== document.body; el = el.parentElement) {
    if (getComputedStyle(el).overflowX !== 'visible') return el
  }
  return undefined
}

/**
 * Keeps an open panel inside its pane: shifts it sideways when it would
 * run past an edge, and narrows it when the pane is narrower than the
 * panel. A panel that opens upward is also capped at the room above its
 * anchor, so in a short window its top (a search field) stays in view and
 * the rest scrolls. The boxes are read once, then written, before the
 * first paint.
 */
function clamp(panel: HTMLElement, placement: PopoverPlacement): void {
  const clip = clipOf(panel)
  const bounds = clip?.getBoundingClientRect() ?? { left: 0, right: document.documentElement.clientWidth, top: 0 }
  const box = panel.getBoundingClientRect()
  const gap = Number.parseFloat(getComputedStyle(panel).getPropertyValue(EDGE_GAP)) || 0
  const surface = panel.firstElementChild
  if (placement.startsWith('top') && surface instanceof HTMLElement) {
    // The panel's bottom is fixed to the anchor, so the room does not depend on what the panel holds yet.
    const room = Math.max(0, box.bottom - bounds.top - gap)
    const own = Number.parseFloat(getComputedStyle(surface).maxHeight)
    if (!(own <= room)) surface.style.maxHeight = `${room}px`
  }
  const room = bounds.right - bounds.left - 2 * gap
  const width = Math.min(box.width, room)
  const left = Math.max(bounds.left + gap, Math.min(box.left, bounds.right - gap - width))
  if (width < box.width) panel.style.maxWidth = `${width}px`
  // A narrowed panel keeps its right edge when right-anchored and its centre when centred; account for that before shifting.
  const narrowedLeft =
    width === box.width ? box.left : placement === 'bottom-center' ? box.left + (box.width - width) / 2 : getComputedStyle(panel).right !== 'auto' ? box.right - width : box.left
  const shift = left - narrowedLeft
  if (shift !== 0) panel.style.translate = `${shift}px 0`
}

/** What can take focus in the anchor. */
const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Floats a popover Surface next to its anchor. It opens and closes at once,
 * in its final place, as a native menu does: the panel mounts and unmounts
 * with no fade or scale. Scrolling is contained so the page behind
 * never moves. The panel stays inside its pane: one that would run past an
 * edge moves in, and one wider than the pane narrows. Closing with Escape while focus is inside puts focus back on
 * the anchor, so the next Tab goes on from there instead of from the top.
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
  returnFocusTo = FOCUSABLE,
  alignTo,
  children,
}: PopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Set when Escape closes the panel with focus in it; the anchor takes focus once the panel is gone.
  const restoreFocus = useRef(false)

  // A deferred panel clamps when it mounts, including after its chunk finishes loading.
  const placePanel = useCallback(
    (panel: HTMLDivElement | null) => {
      panelRef.current = panel
      if (panel === null) return
      // The panel's parent is the root: a panel open on first render gets its ref before the root does.
      const root = panel.parentElement
      const trigger = alignTo === undefined || !placement.endsWith('-start') ? null : root?.querySelector(alignTo)
      if (root && trigger) panel.style.left = `${trigger.getBoundingClientRect().left - root.getBoundingClientRect().left}px`
      clamp(panel, placement)
    },
    [placement, alignTo],
  )

  useLayoutEffect(() => {
    if (open || !restoreFocus.current) return
    restoreFocus.current = false
    rootRef.current?.querySelector<HTMLElement>(returnFocusTo)?.focus()
  }, [open, returnFocusTo])

  useEffect(() => {
    if (!open) return
    // An owner that stayed open after Escape is not closing; forget it.
    restoreFocus.current = false
    // An owner whose content closes on Escape itself (an option list's search) does so before the key
    // bubbles to `onKey`, so mark where focus was on the way down. The close can commit in a later task than
    // the key, so the mark lasts until the panel closes or the next other input, not for a timer.
    const onEscapeDown = (event: KeyboardEvent) => {
      const panel = panelRef.current
      if (event.key !== 'Escape') {
        restoreFocus.current = false
        return
      }
      if (panel === null || !panel.contains(document.activeElement)) return
      restoreFocus.current = true
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        const panel = panelRef.current
        restoreFocus.current = panel !== null && panel.contains(document.activeElement)
        onClose()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      restoreFocus.current = false
      const root = rootRef.current
      if (root && event.target instanceof Node && !root.contains(event.target)) onClose()
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!closeOnBlur) return
      const root = rootRef.current
      if (root && event.target instanceof Node && !root.contains(event.target)) onClose()
    }
    document.addEventListener('keydown', onEscapeDown, true)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onEscapeDown, true)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [open, onClose, closeOnBlur])

  return (
    <div ref={rootRef} {...stylex.props(styles.root)}>
      {anchor}
      {open ? (
        <Suspense fallback={<span data-chunk-pending="" hidden />}>
          <div ref={placePanel} {...stylex.props(styles.panel, placements[placement], widths[width], layers[layer])}>
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
        </Suspense>
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
  // A panel that hangs off the title bar (the avatar menu) is not part of its drag region.
  panel: {
    position: 'absolute',
    // A popover hung off an island in a header layer that lets the pointer through still takes it.
    pointerEvents: 'auto',
    WebkitAppRegion: 'no-drag',
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
  // Centred under the anchor. The clamp's sideways shift is `translate`, which adds to this transform.
  'bottom-center': { top: `calc(100% + ${spacing['--space-1']})`, left: '50%', transform: 'translateX(-50%)' },
  'bottom-end': { top: `calc(100% + ${spacing['--space-1']})`, right: 0 },
  'top-start': { bottom: `calc(100% + ${spacing['--space-1-5']})`, left: 0 },
  'top-end': { bottom: `calc(100% + ${spacing['--space-1-5']})`, right: 0 },
})

const widths = stylex.create({
  menu: { width: layout['--menu-width'] },
  account: { width: layout['--menu-width-account'] },
  browse: { width: layout['--menu-width-browse'] },
  mention: { width: layout['--menu-width-mention'] },
  picker: { width: layout['--menu-width-picker'] },
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

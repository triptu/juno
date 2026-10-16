import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { accent, colors, layout, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { revealFocus } from './internal/revealFocus'
import { ringRoom } from './ringRoom'

export interface PillRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'className'> {
  readonly children?: ReactNode
}

/**
 * A one-line row of pills that scrolls sideways when they do not fit
 * (inventory 2.3). It never grows taller and shows no scrollbar. A vertical
 * wheel scrolls it sideways, and overscroll is contained, so a wheel or a
 * swipe over it never moves the list below or reaches Back and Forward. The
 * side it can scroll toward fades; a `scroll-state` container query shows
 * each fade, so no script watches the scroll. The row keeps room for the
 * pills' focus rings on every side (ringRoom) and scrolls a pill that takes
 * keyboard focus into view whole.
 */
export function PillRow({ children, ...rest }: PillRowProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = ref.current
    if (row === null) return
    // A mouse wheel only moves vertically: turn it into a sideways scroll while the row can move that way.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      const room = row.scrollWidth - row.clientWidth
      if (room <= 0) return
      event.preventDefault()
      row.scrollLeft = Math.max(0, Math.min(room, row.scrollLeft + event.deltaY))
    }
    row.addEventListener('wheel', onWheel, { passive: false })
    return () => row.removeEventListener('wheel', onWheel)
  }, [])
  return (
    <div
      ref={ref}
      data-pill-row=""
      {...rest}
      onFocus={(event) => {
        revealFocus(event)
        rest.onFocus?.(event)
      }}
      {...stylex.props(styles.row, ringRoom.all)}
    >
      <span aria-hidden {...stylex.props(styles.fade, styles.fadeStart)} />
      {children}
      <span aria-hidden {...stylex.props(styles.fade, styles.fadeEnd)} />
    </div>
  )
}

export interface FilterPillProps {
  /** Where the pill is the drop target of a drag: a caret before or after it. */
  readonly mark?: 'before' | 'after'
  /** The 5px dot in the corner. Its place is outside the flow, so it moves nothing. */
  readonly dot?: boolean
  readonly children: ReactNode
}

/** A pill's box in a `PillRow`: holds the button, the corner dot and the drop caret. */
export function FilterPill({ mark, dot = false, children }: FilterPillProps) {
  return (
    <span {...stylex.props(styles.pill)}>
      {children}
      <span aria-hidden data-pill-dot={dot ? '' : undefined} {...stylex.props(styles.dot, dot && styles.dotShown)} />
      {mark === undefined ? null : <span aria-hidden data-drop-mark={mark} {...stylex.props(styles.caret, mark === 'before' ? styles.caretBefore : styles.caretAfter)} />}
    </span>
  )
}

/** The drop caret: a one-off width, named here (tokens.md section 3). */
const CARET_WIDTH = '2px'
const SCROLLS_START = '@container scroll-state(scrollable: inline-start)'
const SCROLLS_END = '@container scroll-state(scrollable: inline-end)'

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    // The pills' height plus the ring's room above and below (ringRoom.all).
    height: `calc(${sizes['--control-28']} + 2 * ${sizes['--focus-ring-room']})`,
    overflowX: 'auto',
    overflowY: 'hidden',
    overscrollBehavior: 'contain',
    scrollbarWidth: 'none',
    containerType: 'scroll-state',
  },
  // Sticky at each end, over the pills, taking no room: the gradient fades
  // the pills that run under it. Each also covers the ring's room past the
  // row's end (ringRoom.all) in solid colour, so a pill half under the edge
  // is cut where it was before the room; a focused pill rises above it.
  fade: {
    position: 'sticky',
    zIndex: 1,
    flexShrink: 0,
    alignSelf: 'stretch',
    width: `calc(${spacing['--space-4']} + ${sizes['--focus-ring-room']})`,
    pointerEvents: 'none',
    opacity: 0,
  },
  fadeStart: {
    insetInlineStart: `calc(-1 * ${sizes['--focus-ring-room']})`,
    marginInlineEnd: `calc(-1 * ${spacing['--space-4']} - ${sizes['--focus-ring-room']} - ${spacing['--space-0-5']})`,
    backgroundImage: `linear-gradient(to right, ${colors['--background-subtle']} ${sizes['--focus-ring-room']}, transparent)`,
    opacity: { default: 0, [SCROLLS_START]: 1 },
  },
  fadeEnd: {
    insetInlineEnd: `calc(-1 * ${sizes['--focus-ring-room']})`,
    marginInlineStart: `calc(-1 * ${spacing['--space-4']} - ${sizes['--focus-ring-room']} - ${spacing['--space-0-5']})`,
    backgroundImage: `linear-gradient(to left, ${colors['--background-subtle']} ${sizes['--focus-ring-room']}, transparent)`,
    opacity: { default: 0, [SCROLLS_END]: 1 },
  },
  pill: {
    position: 'relative',
    zIndex: { default: 'auto', ':has(:focus-visible)': 2 },
    display: 'inline-flex',
    flexShrink: 0,
    maxWidth: layout['--filter-pill-max-width'],
  },
  dot: {
    position: 'absolute',
    top: spacing['--space-1'],
    insetInlineEnd: spacing['--space-1'],
    width: sizes['--unread-dot'],
    height: sizes['--unread-dot'],
    borderRadius: radii['--radius-pill'],
    backgroundColor: accent['--hl'],
    pointerEvents: 'none',
    opacity: 0,
  },
  dotShown: {
    opacity: 1,
  },
  caret: {
    position: 'absolute',
    top: spacing['--space-1-5'],
    bottom: spacing['--space-1-5'],
    width: CARET_WIDTH,
    borderRadius: radii['--radius-pill'],
    backgroundColor: accent['--hl'],
    pointerEvents: 'none',
  },
  caretBefore: {
    insetInlineStart: `calc(-1 * ${spacing['--space-0-5']})`,
  },
  caretAfter: {
    insetInlineEnd: `calc(-1 * ${spacing['--space-0-5']})`,
  },
})

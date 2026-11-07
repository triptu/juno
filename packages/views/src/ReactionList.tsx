import * as stylex from '@stylexjs/stylex'
import { useRef, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { EmptyState, pointerMoved, ScrollArea } from '@juno/ui'

export interface ReactionListProps {
  /** The rows' ids, newest first. */
  readonly ids: ReadonlyArray<string>
  /** Draws one row. The owner wires each id to its own state. */
  readonly renderRow: (id: string) => ReactNode
  /** Nothing to show: the empty state. Undefined while the first rows have not arrived. */
  readonly empty?: boolean
  /**
   * The pointer or keyboard focus came into the list (true), or both left
   * it (false), as on the topic list. The owner holds the order while it is
   * engaged.
   */
  readonly onEngagedChange?: (engaged: boolean) => void
  /** The Update ready pill floats over the list's foot: room after the last row so it can scroll clear, as on the topic list. */
  readonly pillRoom?: boolean
}

const ROW = '[data-reaction-row]'

/**
 * The Reactions view's list (SPEC 5, "Reactions"): in-flow rows in the
 * sidebar's scroller, or a calm empty state. Arrow keys, Home and End move
 * focus between rows; a row opens on Enter or a press.
 */
export function ReactionList({ ids, renderRow, empty, onEngagedChange, pillRoom = false }: ReactionListProps) {
  const inside = useRef({ pointer: false, keyboard: false })
  const engage = (part: 'pointer' | 'keyboard', now: boolean) => {
    const was = inside.current.pointer || inside.current.keyboard
    inside.current[part] = now
    const is = inside.current.pointer || inside.current.keyboard
    if (is !== was) onEngagedChange?.(is)
  }
  return (
    <ScrollArea
      role="group"
      aria-label="Reactions"
      scrollbar="hover"
      onKeyDown={moveFocus}
      onFocus={(event: FocusEvent<HTMLDivElement>) => engage('keyboard', event.target instanceof HTMLElement && event.target.matches(':focus-visible'))}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) engage('keyboard', false)
      }}
      onPointerEnter={(event: PointerEvent<HTMLElement>) => pointerMoved(event) && engage('pointer', true)}
      onPointerLeave={() => engage('pointer', false)}
      onPointerMove={() => engage('pointer', true)}
      sx={[styles.scroller, pillRoom && styles.pillRoom]}
    >
      {ids.length === 0 && empty === true ? (
        <EmptyState illustration="nothing-here" title="No reactions yet" body="When people react to your messages, they show up here." />
      ) : (
        <div role="list" {...stylex.props(styles.rows)}>
          {ids.map(renderRow)}
        </div>
      )}
    </ScrollArea>
  )
}

/** ArrowUp, ArrowDown, Home and End move focus between rows, as in the topic list. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  const key = event.key
  if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return
  const target = event.target
  if (!(target instanceof HTMLElement) || !target.matches(ROW)) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW))
  const index = rows.indexOf(target)
  const next = key === 'ArrowDown' ? rows[index + 1] : key === 'ArrowUp' ? rows[index - 1] : key === 'Home' ? rows[0] : rows[rows.length - 1]
  if (index < 0 || next === undefined) return
  event.preventDefault()
  next.focus({ preventScroll: true })
  next.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

const styles = stylex.create({
  // The topic list's insets, so a row sits where a topic row does.
  scroller: {
    flexGrow: 1,
    paddingInlineStart: layout['--sidebar-inset'],
    paddingInlineEnd: `calc(${layout['--sidebar-inset']} - ${layout['--scrollbar-size']})`,
    paddingBottom: spacing['--space-4'],
  },
  pillRoom: { paddingBottom: `calc(${sizes['--control-30']} + 2 * ${layout['--sidebar-inset']})` },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    minWidth: 0,
  },
})

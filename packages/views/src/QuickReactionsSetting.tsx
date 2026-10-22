import * as stylex from '@stylexjs/stylex'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_QUICK_REACTIONS, MAX_QUICK_REACTIONS, type QuickReaction } from '@juno/contract'
import { accent, colors, motion, opacity, radii, sizes, spacing, z } from '@juno/tokens/tokens.stylex'
import { Button, IconButton, Text } from '@juno/ui'

const HOVER = '@media (hover: hover)'

export interface QuickReactionsSettingProps {
  /** In the order the message menu's grid shows them. */
  readonly reactions: ReadonlyArray<QuickReaction>
  readonly onChange: (reactions: ReadonlyArray<QuickReaction>) => void
  /** Add: the container opens the emoji picker and passes it in `picker`. */
  readonly onAdd: () => void
  /** The open emoji picker, floated under Add (over it when there is no room below). */
  readonly picker?: ReactNode
  /** A press outside the open picker, focus leaving it, or the page scrolling under it. */
  readonly onClosePicker?: () => void
}

/** Moves the item at `from` to `to`. */
function moved<T>(items: ReadonlyArray<T>, from: number, to: number): ReadonlyArray<T> {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

const isDefault = (reactions: ReadonlyArray<QuickReaction>) =>
  reactions.length === DEFAULT_QUICK_REACTIONS.length && reactions.every((reaction, i) => reaction.name === DEFAULT_QUICK_REACTIONS[i]!.name)

/**
 * Settings › Appearance › Quick reactions (SPEC 14): the first emoji of the
 * message menu's grid as a row of pills in their order, then Add, which
 * opens the emoji picker as a popover under Add, up to eleven. The picker is fixed in a
 * portal on `body`, so the card never clips it and never grows for it. A
 * pill drags to a new place. From the keyboard
 * ← and → move between pills, ⌥← and ⌥→ move the pill, and Delete removes
 * it. The last one cannot be removed. Reset to default brings back 👍 ✅ 👀.
 */
export function QuickReactionsSetting({ reactions, onChange, onAdd, picker, onClosePicker }: QuickReactionsSettingProps) {
  const { shown, dragging, onDragStart, onDragOver, endDrag, onDrop } = useDrag(reactions, onChange)
  const [focused, setFocused] = useState<string | undefined>(undefined)
  const listRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const { remove, onKey } = useKeys(listRef, addRef, reactions, onChange)
  usePickerFocus(addRef, pickerRef, picker !== undefined, onClosePicker)
  usePickerPlace(addRef, pickerRef, picker !== undefined)

  const full = reactions.length >= MAX_QUICK_REACTIONS
  // The roving tab stop: the pill last focused, else the first.
  const tabStop = shown.some((reaction) => reaction.name === focused) ? focused : shown[0]?.name

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.row)}>
        <div ref={listRef} role="list" aria-label="Quick reactions" {...stylex.props(styles.list)} onDragOver={(event) => dragging !== undefined && event.preventDefault()} onDrop={onDrop}>
          {shown.map((reaction, index) => (
            <Pill
              key={reaction.name}
              reaction={reaction}
              position={`${index + 1} of ${shown.length}`}
              tabStop={reaction.name === tabStop}
              removable={reactions.length > 1}
              dragging={dragging === reaction.name}
              onFocus={() => setFocused(reaction.name)}
              onKeyDown={(event) => onKey(index, event)}
              onRemove={() => remove(index)}
              onDragStart={(event) => onDragStart(reaction.name, event)}
              onDragOver={(event) => onDragOver(index, event)}
              onDragEnd={endDrag}
            />
          ))}
        </div>
        {/* Dimmed, not disabled, when full: it keeps focus and its tooltip says why. */}
        <div ref={addRef} {...stylex.props(styles.add)}>
          <IconButton
            icon={Plus}
            label={full ? `Up to ${MAX_QUICK_REACTIONS}` : 'Add reaction'}
            size={28}
            dimmed={full}
            aria-haspopup="dialog"
            expanded={picker !== undefined}
            onClick={full ? undefined : onAdd}
          />
        </div>
      </div>
      <div {...stylex.props(styles.footer)}>
        <Text variant="meta" tone="muted" as="p">
          {reactions.length} of {MAX_QUICK_REACTIONS}. Drag to reorder, or use ⌥← and ⌥→.
        </Text>
        <Button variant="ghost" size="sm" tone="muted" disabled={isDefault(reactions)} onClick={() => onChange(DEFAULT_QUICK_REACTIONS)}>
          Reset to default
        </Button>
      </div>
      {picker === undefined
        ? null
        : createPortal(
            <div ref={pickerRef} data-quick-reaction-picker="" {...stylex.props(styles.picker)}>
              {picker}
            </div>,
            document.body,
          )}
    </div>
  )
}

/**
 * The pills' keys: ← → Home End move focus, ⌥← ⌥→ move the pill, Delete
 * and Backspace remove it. A moved pill keeps focus; a removed one hands it
 * to its neighbour, or to Add.
 */
function useKeys(listRef: RefObject<HTMLDivElement | null>, addRef: RefObject<HTMLDivElement | null>, reactions: ReadonlyArray<QuickReaction>, onChange: (reactions: ReadonlyArray<QuickReaction>) => void) {
  // A pill to focus after the list re-renders: one moved, or the neighbour of one removed.
  const focusNext = useRef<string | 'add' | undefined>(undefined)

  useLayoutEffect(() => {
    const target = focusNext.current
    if (target === undefined) return
    focusNext.current = undefined
    if (target === 'add') addRef.current?.querySelector('button')?.focus()
    else listRef.current?.querySelector<HTMLElement>(`[data-quick-reaction="${CSS.escape(target)}"]`)?.focus()
  })

  const remove = (index: number) => {
    if (reactions.length <= 1) return
    const neighbour = reactions[index + 1] ?? reactions[index - 1]
    focusNext.current = neighbour?.name ?? 'add'
    onChange(reactions.filter((_, i) => i !== index))
  }

  const onKey = (index: number, event: KeyboardEvent<HTMLElement>) => {
    const name = reactions[index]!.name
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (step !== 0 && event.altKey) {
      const to = index + step
      if (to < 0 || to >= reactions.length) return
      event.preventDefault()
      focusNext.current = name
      onChange(moved(reactions, index, to))
    } else if (step !== 0 || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const to = event.key === 'Home' ? 0 : event.key === 'End' ? reactions.length - 1 : Math.max(0, Math.min(reactions.length - 1, index + step))
      listRef.current?.querySelector<HTMLElement>(`[data-quick-reaction="${CSS.escape(reactions[to]!.name)}"]`)?.focus()
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      remove(index)
    }
  }

  return { remove, onKey }
}

/**
 * A picker that closes with focus in it (Esc, or a pick) gives focus back to
 * Add. A press outside, focus moving outside, or a scroll outside it (the
 * page moving under it) closes it.
 */
function usePickerFocus(addRef: RefObject<HTMLDivElement | null>, pickerRef: RefObject<HTMLDivElement | null>, pickerOpen: boolean, onClosePicker: (() => void) | undefined) {
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    const active = document.activeElement
    if (wasOpen.current && !pickerOpen && (active === null || active === document.body)) addRef.current?.querySelector('button')?.focus()
    wasOpen.current = pickerOpen
  }, [addRef, pickerOpen])

  useEffect(() => {
    if (!pickerOpen || onClosePicker === undefined) return
    const inside = (target: EventTarget | null) =>
      target instanceof Node && ((addRef.current?.contains(target) ?? false) || (pickerRef.current?.contains(target) ?? false))
    const outside = (event: Event) => {
      if (!inside(event.target)) onClosePicker()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    document.addEventListener('scroll', outside, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('scroll', outside, true)
    }
  }, [addRef, pickerRef, pickerOpen, onClosePicker])
}

/** The picker's gap from Add, and from the window's edges (`--space-1`, `--space-2`). */
const GAP = 4
const EDGE = 8

/**
 * Places the open picker under Add, its start on Add's start, moved in to
 * stay inside the window (or the gallery's frame); over Add when there is no
 * room below. Read once, then written, before the first paint, and again
 * when the window resizes.
 */
function usePickerPlace(addRef: RefObject<HTMLDivElement | null>, pickerRef: RefObject<HTMLDivElement | null>, pickerOpen: boolean) {
  useLayoutEffect(() => {
    if (!pickerOpen) return
    const place = () => {
      const add = addRef.current
      const picker = pickerRef.current
      if (add === null || picker === null) return
      const anchor = add.getBoundingClientRect()
      const box = picker.getBoundingClientRect()
      const bounds = add.closest('[data-tooltip-bounds]')?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      const x = Math.max(bounds.left + EDGE, Math.min(anchor.left, bounds.right - EDGE - box.width))
      const below = anchor.bottom + GAP
      const above = anchor.top - GAP - box.height
      const y = below + box.height <= bounds.bottom - EDGE ? below : above >= bounds.top + EDGE ? above : Math.max(bounds.top + EDGE, bounds.bottom - EDGE - box.height)
      picker.style.translate = `${Math.round(x)}px ${Math.round(y)}px`
    }
    place()
    // The picker's chunk may arrive after the first layout; place it again when it has a size.
    const observer = new ResizeObserver(place)
    if (pickerRef.current !== null) observer.observe(pickerRef.current)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [addRef, pickerRef, pickerOpen])
}

/** Drag to reorder: while a pill is dragged over the row, the row shows the order it would drop in; a drop saves it. */
function useDrag(reactions: ReadonlyArray<QuickReaction>, onChange: (reactions: ReadonlyArray<QuickReaction>) => void) {
  const [dragOrder, setDragOrder] = useState<ReadonlyArray<QuickReaction> | undefined>(undefined)
  const [dragging, setDragging] = useState<string | undefined>(undefined)
  const shown = dragOrder ?? reactions
  const onDragStart = (name: string, event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', name)
    setDragging(name)
  }
  const onDragOver = (index: number, event: DragEvent<HTMLElement>) => {
    if (dragging === undefined) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const from = shown.findIndex((reaction) => reaction.name === dragging)
    if (from !== index && from >= 0) setDragOrder(moved(shown, from, index))
  }
  const endDrag = () => {
    setDragging(undefined)
    setDragOrder(undefined)
  }
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (dragging === undefined) return
    event.preventDefault()
    if (dragOrder !== undefined && dragOrder.some((reaction, i) => reaction.name !== reactions[i]?.name)) onChange(dragOrder)
    endDrag()
  }

  return { shown, dragging, onDragStart, onDragOver, endDrag, onDrop }
}

interface PillProps {
  readonly reaction: QuickReaction
  /** "2 of 5", for the accessible name. */
  readonly position: string
  readonly tabStop: boolean
  readonly removable: boolean
  readonly dragging: boolean
  readonly onFocus: () => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  readonly onRemove: () => void
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void
  readonly onDragEnd: () => void
}

/** One quick reaction: its emoji and, unless it is the last one, a remove button that the keyboard skips (Delete removes). */
function Pill({ reaction, position, tabStop, removable, dragging, onFocus, onKeyDown, onRemove, onDragStart, onDragOver, onDragEnd }: PillProps) {
  const label = reaction.url === undefined ? `${reaction.unicode} ${reaction.name}` : reaction.name
  return (
    <div
      role="listitem"
      tabIndex={tabStop ? 0 : -1}
      draggable
      aria-label={`${label}, ${position}`}
      title={`:${reaction.name}:`}
      data-quick-reaction={reaction.name}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      {...stylex.props(styles.pill, removable && styles.pillRemovable, dragging && styles.pillDragging)}
    >
      {reaction.url === undefined ? (
        <span aria-hidden {...stylex.props(styles.glyph)}>
          {reaction.unicode}
        </span>
      ) : (
        <img src={reaction.url} alt="" draggable={false} decoding="async" {...stylex.props(styles.image)} />
      )}
      {removable ? <IconButton icon={X} label={`Remove ${reaction.name}`} size={20} iconSize={12} tone="muted" tabIndex={-1} noTooltip onClick={onRemove} /> : null}
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
  },
  list: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
  },
  // A reaction pill, the size of a removable chip (28), on the chip's fill.
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    height: sizes['--control-28'],
    paddingInline: spacing['--space-2-5'],
    borderRadius: radii['--radius-tag'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-hover'] },
    },
    cursor: 'default',
    userSelect: 'none',
    transitionProperty: 'background-color, opacity',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: motion['--ease-out'],
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
  },
  pillRemovable: {
    paddingInlineEnd: spacing['--space-1'],
  },
  // The pill being dragged stays in the row at its drop place, faded.
  pillDragging: {
    opacity: opacity['--opacity-dim'],
  },
  glyph: {
    fontSize: sizes['--icon-16'],
    lineHeight: 1,
  },
  image: {
    width: sizes['--icon-16'],
    height: sizes['--icon-16'],
    objectFit: 'contain',
  },
  add: {
    display: 'inline-flex',
  },
  // Under the pills: the count, then Reset right after it, never out at the card's far edge.
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing['--space-2'],
  },
  // Fixed on `body`; `usePickerPlace` moves it next to Add.
  picker: {
    position: 'fixed',
    top: 0,
    left: 0,
    zIndex: z['--z-picker'],
  },
})

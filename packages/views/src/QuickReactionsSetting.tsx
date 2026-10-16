import * as stylex from '@stylexjs/stylex'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { DEFAULT_QUICK_REACTIONS, MAX_QUICK_REACTIONS, type QuickReaction } from '@juno/contract'
import { accent, colors, motion, opacity, radii, sizes, spacing, z } from '@juno/tokens/tokens.stylex'
import { Button, IconButton, Text } from '@juno/ui'

const HOVER = '@media (hover: hover)'

export interface QuickReactionsSettingProps {
  /** In toolbar order. */
  readonly reactions: ReadonlyArray<QuickReaction>
  readonly onChange: (reactions: ReadonlyArray<QuickReaction>) => void
  /** Add: the container opens the emoji picker and passes it in `picker`. */
  readonly onAdd: () => void
  /** The open emoji picker, shown under Add. */
  readonly picker?: ReactNode
  /** A press outside the open picker. */
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
 * Settings › Appearance › Quick reactions (SPEC 14): the toolbar's one-click
 * reactions as a row of pills in toolbar order, then Add, which opens the
 * emoji picker under the row, up to seven. A pill drags to a new place. From the keyboard
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
        <div ref={addRef} {...stylex.props(styles.add)}>
          <IconButton icon={Plus} label={full ? `Up to ${MAX_QUICK_REACTIONS} quick reactions` : 'Add reaction'} size={28} disabled={full} expanded={picker !== undefined} onClick={onAdd} />
        </div>
        {picker === undefined ? null : <div ref={pickerRef} {...stylex.props(styles.picker)}>{picker}</div>}
      </div>
      <div {...stylex.props(styles.footer)}>
        <Text variant="meta" tone="muted" as="p">
          {reactions.length} of {MAX_QUICK_REACTIONS}. Drag to reorder, or use ⌥← and ⌥→.
        </Text>
        <Button variant="ghost" size="sm" tone="muted" disabled={isDefault(reactions)} onClick={() => onChange(DEFAULT_QUICK_REACTIONS)}>
          Reset to default
        </Button>
      </div>
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

/** A picker that closes with focus in it (Esc, or a pick) gives focus back to Add; a press outside closes it. */
function usePickerFocus(addRef: RefObject<HTMLDivElement | null>, pickerRef: RefObject<HTMLDivElement | null>, pickerOpen: boolean, onClosePicker: (() => void) | undefined) {
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    const active = document.activeElement
    if (wasOpen.current && !pickerOpen && (active === null || active === document.body)) addRef.current?.querySelector('button')?.focus()
    wasOpen.current = pickerOpen
  }, [addRef, pickerOpen])

  useEffect(() => {
    if (!pickerOpen || onClosePicker === undefined) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !(addRef.current?.contains(event.target) ?? false) && !(pickerRef.current?.contains(event.target) ?? false)) onClosePicker()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [addRef, pickerRef, pickerOpen, onClosePicker])
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
  // The picker hangs from the row's start, so it stays inside the card wherever Add is.
  row: {
    position: 'relative',
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
  // Under the row, on its start edge.
  picker: {
    position: 'absolute',
    top: `calc(100% + ${spacing['--space-1']})`,
    left: 0,
    zIndex: z['--z-picker'],
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-3'],
    minHeight: sizes['--control-28'],
  },
})

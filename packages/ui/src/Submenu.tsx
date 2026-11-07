import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { OptionList, useOptionListKeys } from './OptionList'
import { Popover } from './Popover'

/** How long the pointer rests on a row before its submenu opens, as on macOS. */
const OPEN_DELAY_MS = 200
/** How long the pointer may rest on another row, on its way to an open submenu, before that row takes over. */
const SETTLE_MS = 300

interface Point {
  readonly x: number
  readonly y: number
}

/** Whether `p` is inside the triangle `a`, `b`, `c`. */
function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const side = (u: Point, v: Point, w: Point) => (u.x - w.x) * (v.y - w.y) - (v.x - w.x) * (u.y - w.y)
  const d1 = side(p, a, b)
  const d2 = side(p, b, c)
  const d3 = side(p, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

export interface SubmenuOptions {
  /** The parent row that opens it, as its `OptionRow` id. */
  readonly triggerId: string
  /** The choices' `OptionRow` ids, in order. */
  readonly ids: ReadonlyArray<string>
  readonly onSelect: (id: string) => void
}

/**
 * A submenu's state, for a menu that owns its list (`useMenuActive`): a
 * row such as Pause notifications whose choices open in their own panel
 * beside the menu, as on macOS. It opens when the pointer rests on the
 * row, on a click, and on → or Enter, which also highlight the first
 * choice and move focus into it. Escape and ← close only the submenu and
 * give focus back to the menu with the row highlighted. While it is open,
 * the pointer can cross other rows on its way into it (the triangle from
 * where it left the row to the panel's near edge) without closing it,
 * unless it rests on one.
 *
 * The owner wires the parent list: `trackPointer` as its `onPointerMove`,
 * `keyDown` first in its `onKeyDown`, `hoverTrigger` when the pointer
 * moves onto the row, `hoverOther(activate)` when it moves onto another,
 * and `clickTrigger` as the row's `onSelect`. Render the row with
 * `Submenu`.
 */
export function useSubmenu({ triggerId, ids, onSelect }: SubmenuOptions) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | undefined>(undefined)
  const focusOnOpen = useRef(false)
  const listId = `${triggerId}-submenu`

  const show = useCallback((focus: boolean) => {
    focusOnOpen.current = focus
    setOpen(true)
    setActive(focus ? ids[0] : undefined)
    // Already open: the list is there to take focus now.
    if (focus) document.getElementById(listId)?.focus({ preventScroll: true })
  }, [ids, listId])

  const hide = useCallback(() => {
    setOpen(false)
    setActive(undefined)
  }, [])

  useEffect(() => {
    if (!open || !focusOnOpen.current) return
    focusOnOpen.current = false
    document.getElementById(listId)?.focus({ preventScroll: true })
  }, [open, listId])

  const pointer = usePointerIntent({ open, listId, show: () => show(false), hide })

  /** Closes the submenu and gives focus back to the parent list, its row highlighted by the owner. */
  const back = () => {
    pointer.close()
    document.getElementById(triggerId)?.closest<HTMLElement>('[role="menu"]')?.focus({ preventScroll: true })
  }
  const listKeys = useOptionListKeys({ ids, activeId: active, onActiveChange: setActive, onSelect, onClose: back })

  return {
    open,
    trackPointer: pointer.track,
    hoverTrigger: pointer.hoverTrigger,
    hoverOther: pointer.hoverOther,
    clickTrigger: () => {
      pointer.cancel()
      show(false)
    },
    /**
     * First in the parent list's `onKeyDown`, with the parent's active row. Handles the event and returns true for
     * → and Enter on the row (opens with the first choice highlighted) and Escape while open (closes only the
     * submenu); a move to another row closes it. Keys pressed in the submenu are left to it.
     */
    keyDown: (event: KeyboardEvent<HTMLElement>, parentActive: string | undefined): boolean =>
      parentKey(event, { open, onTrigger: parentActive === triggerId, close: pointer.close, show: () => {
        pointer.cancel()
        show(true)
      } }),
    /** The submenu's list: spread on `Submenu`. */
    list: {
      id: listId,
      activeId: active,
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        event.stopPropagation()
        if (event.key === 'ArrowLeft' || event.key === 'Escape') {
          event.preventDefault()
          back()
          return
        }
        listKeys(event)
      },
      onPointerLeave: () => setActive(undefined),
    },
    row: (id: string) => ({ id, active: active === id, onActivate: () => setActive(id) }),
    hide: pointer.close,
  }
}

/** A key in the parent list: see `useSubmenu`'s `keyDown`. */
function parentKey(event: KeyboardEvent<HTMLElement>, { open, onTrigger, close, show }: { readonly open: boolean; readonly onTrigger: boolean; readonly close: () => void; readonly show: () => void }): boolean {
  if (event.target !== event.currentTarget) return true
  if (open && event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return true
  }
  if (onTrigger && (event.key === 'ArrowRight' || event.key === 'Enter')) {
    event.preventDefault()
    show()
    return true
  }
  if (open && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) close()
  return false
}

type Timer = ReturnType<typeof setTimeout> | undefined

/**
 * The pointer's side of a submenu: the rest on the row before it opens, and the path into the open panel, which
 * may cross other rows of the parent. The apex is where the pointer was when it left the row.
 */
function usePointerIntent({ open, listId, show, hide }: { readonly open: boolean; readonly listId: string; readonly show: () => void; readonly hide: () => void }) {
  const timers = useRef<{ open: Timer; settle: Timer }>({ open: undefined, settle: undefined })
  const last = useRef<Point | undefined>(undefined)
  const apex = useRef<Point | undefined>(undefined)

  const cancel = useCallback(() => {
    clearTimeout(timers.current.open)
    clearTimeout(timers.current.settle)
    timers.current = { open: undefined, settle: undefined }
    apex.current = undefined
  }, [])
  useEffect(() => cancel, [cancel])

  const close = () => {
    cancel()
    hide()
  }

  return {
    cancel,
    close,
    /** The parent list's `onPointerMove`. */
    track: (event: PointerEvent<HTMLElement>) => {
      last.current = { x: event.clientX, y: event.clientY }
    },
    /** The pointer is on the row: opens after a short rest. */
    hoverTrigger: () => {
      clearTimeout(timers.current.settle)
      apex.current = undefined
      if (open || timers.current.open !== undefined) return
      timers.current.open = setTimeout(() => {
        timers.current.open = undefined
        show()
      }, OPEN_DELAY_MS)
    },
    /** The pointer is on another row of the parent: `activate` it now, or once the pointer rests when it is heading into the open submenu. */
    hoverOther: (activate: () => void) => {
      clearTimeout(timers.current.open)
      timers.current.open = undefined
      const panel = document.getElementById(listId)?.getBoundingClientRect()
      const point = last.current
      if (open && panel !== undefined && point !== undefined) {
        apex.current ??= point
        const from = apex.current
        const edge = panel.left >= from.x ? panel.left : panel.right
        if (inTriangle(point, from, { x: edge, y: panel.top }, { x: edge, y: panel.bottom })) {
          clearTimeout(timers.current.settle)
          timers.current.settle = setTimeout(() => {
            close()
            activate()
          }, SETTLE_MS)
          return
        }
      }
      if (open) close()
      activate()
    },
  }
}

export interface SubmenuProps {
  readonly open: boolean
  readonly onClose: () => void
  /** The parent row that opens it, rendered in place. */
  readonly trigger: ReactNode
  readonly label: string
  /** `useSubmenu`'s `list`. */
  readonly list: {
    readonly id: string
    readonly activeId: string | undefined
    readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
    readonly onPointerLeave: () => void
  }
  /** The choices, as `OptionRow`s with `useSubmenu`'s `row(id)`. */
  readonly children: ReactNode
}

/**
 * A submenu's panel beside its parent menu (`useSubmenu`): a `right-start`
 * Popover, which flips to the left when the right has no room, so nothing
 * changes under the pointer and the menu keeps its size.
 */
export function Submenu({ open, onClose, trigger, label, list, children }: SubmenuProps) {
  return (
    <Popover open={open} onClose={onClose} anchor={trigger} placement="right-start" width="menu" role="presentation">
      <OptionList role="menu" label={label} focusable {...list}>
        {children}
      </OptionList>
    </Popover>
  )
}

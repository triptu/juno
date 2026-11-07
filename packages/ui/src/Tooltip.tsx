import * as stylex from '@stylexjs/stylex'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { colors, layout, motion, radii, shadows, spacing, z } from '@juno/tokens/tokens.stylex'
import { variants as typeVariants } from './internal/type'

/** How long the pointer or keyboard focus rests on a control before its tooltip shows, as on macOS. */
const DELAY_MS = 700
/** After a tooltip hides, the next control's shows at once for this long, so moving along a toolbar reads each name. */
const WARM_MS = 600

/**
 * The attributes that give any element a tooltip: the label, and a
 * shortcut drawn as keycaps ("⌘["). `TooltipLayer` shows it; nothing is
 * mounted per element.
 */
export function tooltip(label: string, keys?: string): { readonly 'data-tooltip': string; readonly 'data-tooltip-keys'?: string } {
  return keys === undefined ? { 'data-tooltip': label } : { 'data-tooltip': label, 'data-tooltip-keys': keys }
}

const SELECTOR = '[data-tooltip]'
/** An ancestor with this attribute bounds the tooltip instead of the window (the gallery's frame). */
const BOUNDS = '[data-tooltip-bounds]'
const MODIFIERS = new Set(['⌘', '⌃', '⌥', '⇧'])

/** "⌃⌘S" as keycaps: each modifier on its own, then the key. */
function keycaps(keys: string): ReadonlyArray<string> {
  const caps: string[] = []
  let rest = keys
  while (rest.length > 0 && MODIFIERS.has(rest[0]!)) {
    caps.push(rest[0]!)
    rest = rest.slice(1)
  }
  if (rest.length > 0) caps.push(rest)
  return caps
}

interface Shown {
  readonly target: HTMLElement
  readonly label: string
  readonly keys: string | undefined
  /** Shown at once from the warm window: no fade. */
  readonly warm: boolean
}

/** A control whose own menu is open says nothing over it. */
const quiet = (el: HTMLElement) => el.getAttribute('aria-expanded') === 'true' || el.dataset.tooltip === ''

/**
 * When a tooltip shows and hides. `aim` names the control under the pointer
 * or keyboard focus (undefined for none); `press` hides it until the
 * pointer leaves that control; `dismiss` hides it.
 */
function tooltipTimer(set: (shown: Shown | undefined) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: HTMLElement | undefined
  let visible = false
  let hiddenAt = Number.NEGATIVE_INFINITY
  // The control pressed or dismissed with Esc: nothing until the pointer leaves it.
  let muted: HTMLElement | undefined

  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const show = (target: HTMLElement, warm: boolean) => {
    cancel()
    if (!target.isConnected || quiet(target)) return
    visible = true
    set({ target, label: target.dataset.tooltip ?? '', keys: target.dataset.tooltipKeys, warm })
  }
  const hide = (warmNext: boolean) => {
    cancel()
    if (visible) hiddenAt = warmNext ? performance.now() : Number.NEGATIVE_INFINITY
    visible = false
    set(undefined)
  }
  return {
    get current() {
      return current
    },
    get visible() {
      return visible
    },
    aim(target: HTMLElement | undefined) {
      if (target === current) return
      if (current !== undefined && current === muted) muted = undefined
      const wasVisible = visible
      current = target === muted ? undefined : target
      if (current === undefined) return hide(true)
      if (wasVisible || performance.now() - hiddenAt < WARM_MS) return show(current, true)
      hide(false)
      const next = current
      timer = setTimeout(() => show(next, false), DELAY_MS)
    },
    press() {
      muted = current
      hide(false)
    },
    dismiss: () => hide(false),
    cancel,
  }
}

/** Feeds the document's pointer, focus, key and scroll events to `timer`. Returns the cleanup. */
function listen(timer: ReturnType<typeof tooltipTimer>): () => void {
  const under = (target: EventTarget | null) => (target instanceof Element ? (target.closest<HTMLElement>(SELECTOR) ?? undefined) : undefined)
  // Nothing shows while a button is held: a tab dragged along the strip passes over other tabs.
  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') timer.aim(event.buttons === 0 ? under(event.target) : undefined)
  }
  // Leaving the window: nothing is under the pointer.
  const onPointerOut = (event: PointerEvent) => {
    if (event.relatedTarget === null) timer.aim(undefined)
  }
  // Keyboard focus only: a click focuses too, and the press already hid it.
  const onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) timer.aim(under(event.target))
  }
  const onFocusOut = (event: FocusEvent) => {
    const current = timer.current
    if (current !== undefined && event.target === current && !current.matches(':hover')) timer.aim(undefined)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && timer.visible) timer.press()
  }
  const onPress = () => timer.press()
  const onDismiss = () => timer.dismiss()
  const listeners: ReadonlyArray<readonly [EventTarget, string, (event: never) => void, boolean]> = [
    [document, 'pointerover', onPointerOver, false],
    [document, 'pointerout', onPointerOut, false],
    [document, 'pointerdown', onPress, true],
    [document, 'focusin', onFocusIn, false],
    [document, 'focusout', onFocusOut, false],
    [document, 'keydown', onKeyDown, true],
    [document, 'scroll', onDismiss, true],
    [document, 'dragstart', onDismiss, true],
    [window, 'blur', onDismiss, false],
  ]
  for (const [target, type, listener, capture] of listeners) target.addEventListener(type, listener as EventListener, capture)
  return () => {
    timer.cancel()
    for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener as EventListener, capture)
  }
}

/**
 * Puts `tip` under `target`, or over it when there is no room below, never
 * on it, moved in to stay inside the window (or a `data-tooltip-bounds`
 * ancestor). One read of the boxes, then one write.
 */
function place(tip: HTMLElement, target: HTMLElement): void {
  const anchor = target.getBoundingClientRect()
  const box = tip.getBoundingClientRect()
  const bounds = target.closest(BOUNDS)?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  const style = getComputedStyle(tip)
  const gap = Number.parseFloat(style.getPropertyValue('--tooltip-gap')) || 0
  const edge = Number.parseFloat(style.getPropertyValue('--tooltip-edge')) || 0
  const centred = anchor.left + anchor.width / 2 - box.width / 2
  const x = Math.max(bounds.left + edge, Math.min(centred, bounds.right - edge - box.width))
  const below = anchor.bottom + gap
  const y = below + box.height <= bounds.bottom - edge ? below : Math.max(bounds.top + edge, anchor.top - gap - box.height)
  tip.style.translate = `${Math.round(x)}px ${Math.round(y)}px`
}

/**
 * The app's one tooltip (primitives, Tooltip). Mount it once at the root.
 * It listens on the document for elements with `data-tooltip` (see
 * `tooltip()`), so a toolbar on every message costs nothing until one is
 * hovered.
 *
 * - Shows after 700ms of hover, or of keyboard focus. Once one has shown,
 *   a neighbour's shows at once for 600ms.
 * - Hides on mouse down (and stays hidden until the pointer leaves that
 *   control), on scroll, on Esc, on a drag (a held button shows none, so a
 *   dragged tab passes its neighbours quietly) and when the window loses focus.
 * - Sits under the control, or over it when there is no room below, never
 *   on it, and moves in to stay inside the window. It is fixed in a
 *   portal, so it moves nothing.
 * - `role="tooltip"`; the control points at it with `aria-describedby`
 *   while it shows.
 * - `detail` may add a line under the label for some controls, from the
 *   control itself (a person's status under "Message Maya Chen"). It can
 *   arrive after the tip shows; the tip is placed again when its size
 *   changes.
 */
export function TooltipLayer({ detail }: { readonly detail?: (target: HTMLElement) => ReactNode } = {}) {
  const id = useId()
  const [shown, setShown] = useState<Shown | undefined>(undefined)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => listen(tooltipTimer(setShown)), [])

  // Placed before the first paint, and again when a detail line changes its size.
  useLayoutEffect(() => {
    const tip = ref.current
    if (shown === undefined || tip === null) return
    const target = shown.target
    place(tip, target)
    const observer = new ResizeObserver(() => place(tip, target))
    observer.observe(tip)
    const before = target.getAttribute('aria-describedby')
    target.setAttribute('aria-describedby', before === null ? id : `${before} ${id}`)
    return () => {
      observer.disconnect()
      if (before === null) target.removeAttribute('aria-describedby')
      else target.setAttribute('aria-describedby', before)
    }
  }, [shown, id])

  if (shown === undefined) return null
  const line = (
    <>
      <span {...stylex.props(styles.label)}>{shown.label}</span>
      {shown.keys === undefined ? null : (
        <span {...stylex.props(styles.keys)}>
          {keycaps(shown.keys).map((cap, i) => (
            <kbd key={i} {...stylex.props(styles.cap, typeVariants.kbd)}>
              {cap}
            </kbd>
          ))}
        </span>
      )}
    </>
  )
  const more = detail?.(shown.target)
  return createPortal(
    <div ref={ref} id={id} role="tooltip" {...stylex.props(styles.tip, typeVariants.meta, !shown.warm && styles.fade)}>
      {more === undefined || more === null ? (
        line
      ) : (
        <span {...stylex.props(styles.stack)}>
          <span {...stylex.props(styles.line)}>{line}</span>
          {more}
        </span>
      )}
    </div>,
    document.body,
  )
}

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
})

const styles = stylex.create({
  tip: {
    '--tooltip-gap': spacing['--space-1-5'],
    '--tooltip-edge': spacing['--space-2'],
    position: 'fixed',
    top: 0,
    left: 0,
    zIndex: z['--z-tooltip'],
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    boxSizing: 'border-box',
    maxWidth: layout['--tooltip-max-width'],
    paddingBlock: spacing['--space-1'],
    paddingInline: spacing['--space-2'],
    borderRadius: radii['--radius-md'],
    backgroundColor: colors['--surface-raised'],
    color: colors['--foreground-default'],
    boxShadow: shadows['--pop-shadow'],
    pointerEvents: 'none',
    userSelect: 'none',
    WebkitAppRegion: 'no-drag',
  },
  fade: {
    animationName: fadeIn,
    animationDuration: motion['--duration-fast'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  label: {
    overflowWrap: 'anywhere',
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    minWidth: 0,
  },
  line: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
  },
  keys: {
    display: 'inline-flex',
    gap: spacing['--space-0-5'],
    flexShrink: 0,
  },
  cap: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: spacing['--space-4'],
    height: spacing['--space-4'],
    boxSizing: 'border-box',
    paddingInline: spacing['--space-1'],
    borderRadius: radii['--radius-xs'],
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-subtle'],
    fontVariantNumeric: 'tabular-nums',
  },
})

import type { Page } from '@playwright/test'
import { formatLayoutShiftReport } from './layoutShift'
import { withHelpers, type MovedElement } from './inPage'

export interface ForcedInteractionOptions {
  /** CSS selector of the region to check. Default: the gallery's `[data-fixture-frame]`, else `body`. */
  readonly root?: string
  /** CSS selector of the elements to touch. */
  readonly targets: string
  /** Elements inside a match of this selector are not touched (growth the user asks for). */
  readonly skipWithin?: string
  /** Elements touched at most; a longer list gives its first ones and its last three. Default 8, as the walk. */
  readonly max?: number
  /** Index in that list to start at, after `next` asked for a fresh state. */
  readonly from?: number
  /** Marks code still loading after a touch; the check waits until none is left. */
  readonly pending?: string
  readonly tolerance?: number
  readonly grows?: string
}

export interface ForcedShift {
  /** Index of the touched element in the sampled list. */
  readonly element: number
  readonly target: string
  readonly step: string
  readonly moved: ReadonlyArray<MovedElement>
}

export interface ForcedInteractionReport {
  readonly shifts: ReadonlyArray<ForcedShift>
  /** Elements touched in this call. */
  readonly touched: number
  /** Set when a touch removed or hid elements still to touch: open the state again and call with `from: next`. */
  readonly next?: number
  /** Pseudo-class rules in this document that could not be rewritten, for the log. */
  readonly unforced: number
  /** Milliseconds spent dispatching, waiting and reading boxes, for the log. */
  readonly timing: { readonly act: number; readonly settle: number; readonly boxes: number }
}

// The functions below run in the page, through `toString()`: each uses nothing outside its own body.

/**
 * Rewrites `:hover`, `:active`, `:focus`, `:focus-visible` and `:focus-within` in every loaded sheet into
 * `[data-juno-…]` attribute selectors, which have the same specificity. Sheets are remembered by rule count,
 * so a document that opens many states rewrites only the sheets its chunks add. Also turns transitions off and
 * keeps a synthetic click from following a link or submitting a form. Returns the rules it could not rewrite.
 */
function forcePseudoClasses(): number {
  const pseudo = /:(hover|active|focus-visible|focus-within|focus)(?![\w-])/g
  const scope = window as unknown as { __junoForcedSheets?: WeakMap<CSSStyleSheet, number>; __junoUnforced?: number }
  const seen = (scope.__junoForcedSheets ??= new WeakMap())
  scope.__junoUnforced ??= 0
  const rewrite = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText.search(pseudo) !== -1) {
        rule.selectorText = rule.selectorText.replace(pseudo, (_, name: string) => `[data-juno-${name}]`)
        // A pseudo-element before the pseudo-class (a scrollbar thumb's :hover) cannot take an attribute.
        if (rule.selectorText.search(pseudo) !== -1) scope.__junoUnforced!++
      }
      if ('cssRules' in rule) rewrite((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of [...Array.from(document.styleSheets), ...document.adoptedStyleSheets]) {
    try {
      if (seen.get(sheet) === sheet.cssRules.length) continue
      rewrite(sheet.cssRules)
      seen.set(sheet, sheet.cssRules.length)
    } catch {
      // A cross-origin sheet cannot be read; the gallery has none.
    }
  }
  if (!document.getElementById('juno-forced-still')) {
    const still = document.createElement('style')
    still.id = 'juno-forced-still'
    still.textContent = '*, *::before, *::after { transition: none !important; }'
    document.head.append(still)
    window.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('a[href], form button:not([type="button"]), form input[type="submit"]')) event.preventDefault()
    })
  }
  return scope.__junoUnforced
}

/**
 * Lets the page answer a touch: two tasks so React renders (a continuous event's update, then an effect's),
 * the code the touch started loading, then the animations it started, finished, and the tasks after them.
 * Then the focus attributes follow the active element.
 */
function settler(pending: string | null, earlier: ReadonlySet<Animation>, syncFocus: () => void, forcePseudo: () => number): () => Promise<void> {
  const task = () => new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.addEventListener('message', () => resolve())
    channel.port1.start()
    channel.port2.postMessage(0)
  })
  const loaded = (selector: string) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect()
      reject(new Error('Code a touch started loading did not arrive within 15 s'))
    }, 15_000)
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector) !== null) return
      clearTimeout(timer)
      observer.disconnect()
      resolve()
    })
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true })
  })
  return async () => {
    await task()
    await task()
    if (pending !== null && document.querySelector(pending) !== null) {
      await loaded(pending)
      forcePseudo()
      await task()
      await task()
    }
    for (let round = 0; round < 4; round++) {
      const started = document.getAnimations().filter((animation) => !earlier.has(animation) && animation.playState !== 'finished' && Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
      if (started.length === 0) break
      for (const animation of started) {
        try {
          animation.finish()
        } catch {
          // An animation that cannot finish (playback rate 0) moves nothing either.
        }
      }
      await task()
      await task()
    }
    syncFocus()
  }
}

/**
 * The touches a person makes, as the browser would show them: the pseudo-class attributes where it would match
 * (the element under the point and its ancestors for hover and press, the active element and its ancestors for
 * focus) and the pointer, mouse, key and focus events it would fire.
 */
function touches() {
  let keyboard = false
  const chain = (el: Element): Element[] => {
    const out: Element[] = []
    for (let node: Element | null = el; node; node = node.parentElement) out.push(node)
    return out
  }
  const clear = (name: string) => {
    for (const el of Array.from(document.querySelectorAll(`[${name}]`))) el.removeAttribute(name)
  }
  const syncFocus = () => {
    for (const name of ['data-juno-focus', 'data-juno-focus-visible', 'data-juno-focus-within']) clear(name)
    const active = document.activeElement
    if (!active || active === document.body) return
    active.setAttribute('data-juno-focus', '')
    const field = active.matches('input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="color"]), textarea, [contenteditable]:not([contenteditable="false"])')
    if (keyboard || field) active.setAttribute('data-juno-focus-visible', '')
    for (const el of chain(active)) el.setAttribute('data-juno-focus-within', '')
  }
  const fire = (type: string, target: Element, x: number, y: number, extra: { buttons?: number; bubbles?: boolean } = {}) => {
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra }
    return target.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init))
  }
  const each = (type: string, els: ReadonlyArray<Element>, x: number, y: number) => {
    for (const el of els) fire(type, el, x, y, { bubbles: false })
  }
  return {
    syncFocus,
    hover(hit: Element, x: number, y: number) {
      const outward = chain(hit)
      fire('pointerover', hit, x, y)
      each('pointerenter', outward.toReversed(), x, y)
      fire('mouseover', hit, x, y)
      each('mouseenter', outward.toReversed(), x, y)
      fire('pointermove', hit, x, y)
      fire('mousemove', hit, x, y)
      for (const el of outward) el.setAttribute('data-juno-hover', '')
    },
    focus(element: HTMLElement) {
      const keyTarget = document.activeElement ?? document.body
      keyTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true, bubbles: true, cancelable: true, composed: true }))
      keyTarget.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true, cancelable: true, composed: true }))
      keyboard = true
      element.focus({ preventScroll: true })
    },
    press(hit: Element, x: number, y: number) {
      fire('pointerdown', hit, x, y, { buttons: 1 })
      const unprevented = fire('mousedown', hit, x, y, { buttons: 1 })
      for (const el of chain(hit)) el.setAttribute('data-juno-active', '')
      // A press moves focus to what it lands on, or away when that cannot take it.
      keyboard = false
      if (!unprevented) return
      const into = hit.closest('button, a[href], input, select, textarea, [tabindex], [contenteditable]:not([contenteditable="false"])')
      if (into instanceof HTMLElement && !into.matches(':disabled')) into.focus({ preventScroll: true })
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    },
    release(hit: Element, x: number, y: number) {
      fire('pointerup', hit, x, y)
      fire('mouseup', hit, x, y)
      clear('data-juno-active')
      if (hit.isConnected) fire('click', hit, x, y)
    },
    leave(hit: Element, x: number, y: number) {
      const outward = chain(hit)
      fire('pointerout', hit, x, y)
      each('pointerleave', outward, x, y)
      fire('mouseout', hit, x, y)
      each('mouseleave', outward, x, y)
      clear('data-juno-hover')
    },
  }
}

/** The elements to touch: the first ones and the last three of those matching, as the real-input walk picks them. */
function sampleTargets(rootEl: HTMLElement, targets: string, skipWithin: string | null, max: number): HTMLElement[] {
  const all = Array.from(rootEl.querySelectorAll(targets)).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && (skipWithin === null || el.parentElement?.closest(skipWithin) == null),
  )
  const tail = Math.min(3, max)
  return all.length <= max ? all : [...all.slice(0, max - tail), ...all.slice(-tail)]
}

/**
 * The cheap tier of the guard: every touch of `measureLayoutShift`, without real input or animation frames, in
 * one `page.evaluate`. For each target it hovers, focuses from the keyboard, blurs, presses, releases and leaves
 * (`touches`), lets the page answer (`settler`) and compares every box with `changedBoxes`, the guard's own
 * comparison, after each step.
 *
 * What it cannot see: a shift that exists only while a transition runs, one that waits for an animation frame
 * or a ResizeObserver, and browser defaults of real input other than focus on press (text selection, `:active`
 * from a keyboard press). The real-input walk covers those.
 */
export async function checkForcedInteractions(page: Page, options: ForcedInteractionOptions): Promise<ForcedInteractionReport> {
  return (await withHelpers(
    page,
    async (arg: { root: string; targets: string; skipWithin: string | null; max: number; from: number; pending: string | null; tolerance: number; grows: string | null }, h) => {
      const found = document.querySelector(arg.root)
      const rootEl = found instanceof HTMLElement ? found : document.body
      const unforced = h.forcePseudoClasses()
      const touch = h.touches()
      const settle = h.settler(arg.pending, new Set(document.getAnimations()), touch.syncFocus, h.forcePseudoClasses)
      const picked = h.sampleTargets(rootEl, arg.targets, arg.skipWithin, arg.max)
      const drawn = new Set(picked.filter((el) => el.getClientRects().length > 0))
      const timing = { act: 0, settle: 0, boxes: 0 }
      const shifts: ForcedShift[] = []
      let touched = 0
      let boxes = h.layoutBoxes(rootEl)
      for (let index = arg.from; index < picked.length; index++) {
        const element = picked[index]!
        if (!element.isConnected || element.getClientRects().length === 0 || getComputedStyle(element).visibility === 'hidden') continue
        const was = element.getBoundingClientRect()
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        const box = element.getBoundingClientRect()
        if (box.x !== was.x || box.y !== was.y) {
          // Scrolling can lay out content-visibility rows; that is not the touch's doing.
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
          boxes = h.layoutBoxes(rootEl)
        }
        touched++
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        const hit = document.elementFromPoint(x, y) ?? element
        const target = h.describeNode(element)
        const step = async (name: string, action: () => void) => {
          const t0 = performance.now()
          action()
          const t1 = performance.now()
          await settle()
          const t2 = performance.now()
          const now = h.layoutBoxes(rootEl)
          const moved = h.changedBoxes(boxes, now, arg.tolerance, arg.grows, h.describeNode)
          if (moved.length > 0) shifts.push({ element: index, target, step: name, moved })
          boxes = now
          timing.act += t1 - t0
          timing.settle += t2 - t1
          timing.boxes += performance.now() - t2
        }
        await step('hover', () => touch.hover(hit, x, y))
        await step('focus from the keyboard', () => touch.focus(element))
        await step('blur', () => element.blur())
        await step('press', () => touch.press(hit, x, y))
        await step('release', () => touch.release(hit, x, y))
        await step('leave', () => touch.leave(hit, x, y))
        // A touch that took away or hid elements still to touch (Undo puts back other buttons) needs a fresh state for the rest.
        // Other changes stay: what follows is still something a person can do, and each step is measured on its own.
        if (picked.slice(index + 1).some((next) => drawn.has(next) && (!next.isConnected || next.getClientRects().length === 0))) return { shifts, touched, next: index + 1, unforced, timing }
      }
      return { shifts, touched, unforced, timing }
    },
    {
      root: options.root ?? '[data-fixture-frame]',
      targets: options.targets,
      skipWithin: options.skipWithin ?? null,
      max: options.max ?? 8,
      from: options.from ?? 0,
      pending: options.pending ?? null,
      tolerance: options.tolerance ?? 0.5,
      grows: options.grows ?? null,
    },
    { forcePseudoClasses, settler, touches, sampleTargets },
  )) as ForcedInteractionReport
}

/** A forced shift in the guard's report format. */
export function formatForcedShift(shift: ForcedShift): string {
  return `${shift.step}: Layout shifted during the action.\n${formatLayoutShiftReport({ shifts: [], moved: shift.moved, observerSupported: true, waitedMs: 0 })}`
}

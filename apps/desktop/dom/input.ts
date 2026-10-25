/**
 * Input for the DOM lane (README): `Dom` sends events in the order a
 * browser sends them and does the few default actions a browser would
 * (focus on press, Tab, typing into a field, Enter or Space on a button),
 * at no coordinate.
 */
import type { Window } from 'happy-dom'
import { disabled, Query, roleOf, shown, type El, type RoleOptions, type TextMatch } from './query'
import { HOVER_ATTRIBUTE } from './window'

const DEFAULT_TIMEOUT = 5_000

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

const MODIFIERS = { Meta: 'metaKey', Shift: 'shiftKey', Alt: 'altKey', Control: 'ctrlKey' } as const
type Modifier = keyof typeof MODIFIERS

const CODES: Record<string, string> = { ' ': 'Space', Alt: 'AltLeft', Meta: 'MetaLeft', Shift: 'ShiftLeft', Control: 'ControlLeft', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' }
const codeOf = (key: string) => CODES[key] ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : key)

const TABBABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]'

/**
 * Input for one window. It keeps what a browser keeps between events: the
 * element under the pointer, and whether the last focus came from a
 * pointer or the keyboard (`:focus-visible`, `window.ts`).
 */
export class Dom {
  #hovered: El | null = null
  /** Keys held down with `down`, until `up`. */
  readonly #held = new Set<string>()

  constructor(readonly window: Window) {}

  get document(): Document {
    return this.window.document as unknown as Document
  }

  get active(): El | null {
    return this.document.activeElement as El | null
  }

  /** As Playwright's `page.keyboard`: keys go to the focused element. */
  get keyboard(): { readonly press: (keys: string) => Promise<void>; readonly type: (text: string) => Promise<void>; readonly down: (key: string) => Promise<void>; readonly up: (key: string) => Promise<void> } {
    return { press: (keys) => this.press(keys), type: (text) => this.type(text), down: async (key) => this.down(key), up: async (key) => this.up(key) }
  }

  /** The whole page, as a Query. */
  get page(): Query {
    return new Query(this, () => [this.document.documentElement as El], 'page')
  }

  locator(selector: string): Query {
    return this.page.locator(selector)
  }

  getByRole(role: string, options?: RoleOptions): Query {
    return this.page.getByRole(role, options)
  }

  getByText(text: TextMatch, options?: { readonly exact?: boolean }): Query {
    return this.page.getByText(text, options)
  }

  getByLabel(text: TextMatch, options?: { readonly exact?: boolean }): Query {
    return this.page.getByLabel(text, options)
  }

  getByTitle(text: TextMatch, options?: { readonly exact?: boolean }): Query {
    return this.page.getByTitle(text, options)
  }

  /** Polls `check` until it answers something other than undefined, null or false, or fails after `timeout`. */
  async until<T>(what: string, check: () => T | undefined | null | false, timeout = DEFAULT_TIMEOUT): Promise<T> {
    const deadline = performance.now() + timeout
    let last: unknown
    for (;;) {
      try {
        const value = check()
        if (value !== undefined && value !== null && value !== false) return value
      } catch (error) {
        last = error
      }
      if (performance.now() > deadline) throw new Error(`Timed out after ${timeout} ms waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}\nPage text: ${normalize(this.document.body?.textContent ?? '').slice(0, 800)}`)
      await this.changed()
    }
  }

  /**
   * Resolves at the page's next change (a node, an attribute or text), or
   * after `millis`: a wait checks again when there is something new to see,
   * not on a fast timer. Focus and the fake's state change no node, so the
   * timer still runs. Bun's timer, which a test clock does not hold.
   */
  changed(millis = 50): Promise<void> {
    return new Promise((done) => {
      const Observer = (this.window as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver
      const finish = () => {
        clearTimeout(timer)
        observer.disconnect()
        done()
      }
      const observer = new Observer(finish)
      observer.observe(this.document, { subtree: true, childList: true, attributes: true, characterData: true })
      const timer = setTimeout(finish, millis)
    })
  }

  #pointerFocus(value: boolean): void {
    (this.window as unknown as { __domPointerFocus?: boolean }).__domPointerFocus = value
  }

  #mouse(type: string, el: El, init: MouseEventInit & PointerEventInit = {}): boolean {
    const W = this.window as unknown as { PointerEvent: typeof PointerEvent; MouseEvent: typeof MouseEvent }
    const pointer = type.startsWith('pointer')
    const Event = pointer ? W.PointerEvent : W.MouseEvent
    const bubbles = !type.endsWith('enter') && !type.endsWith('leave')
    const pressed = type.endsWith('down') || type === 'pointermove' || type === 'mousemove'
    return el.dispatchEvent(new Event(type, {
      bubbles, cancelable: bubbles, composed: true, button: 0, buttons: pressed && type.endsWith('down') ? 1 : 0,
      detail: /click|down|up$/.test(type) ? 1 : 0, view: this.window as never,
      ...(pointer ? { pointerId: 1, pointerType: 'mouse', isPrimary: true } : {}), ...init,
    }))
  }

  /** Moves the pointer onto `el`: out of what it was over and over `el`, with enter and leave for the elements between. */
  hover(el: El): void {
    const from = this.#hovered !== null && this.#hovered.isConnected ? this.#hovered : null
    if (from !== el) {
      const chain = (node: El | null) => { const list: El[] = []; for (let at = node; at !== null; at = at.parentElement) list.push(at); return list }
      const left = chain(from), entered = chain(el)
      if (from !== null) for (const type of ['pointerout', 'mouseout']) this.#mouse(type, from, { relatedTarget: el })
      for (const node of left.filter((node) => !entered.includes(node))) for (const type of ['pointerleave', 'mouseleave']) this.#mouse(type, node, { relatedTarget: el })
      for (const type of ['pointerover', 'mouseover']) this.#mouse(type, el, { relatedTarget: from })
      for (const node of left.filter((node) => !entered.includes(node))) node.removeAttribute(HOVER_ATTRIBUTE)
      for (const node of entered) node.setAttribute(HOVER_ATTRIBUTE, '')
      for (const node of entered.filter((node) => !left.includes(node)).toReversed()) for (const type of ['pointerenter', 'mouseenter']) this.#mouse(type, node, { relatedTarget: from })
      this.#hovered = el
    }
    for (const type of ['pointermove', 'mousemove']) this.#mouse(type, el)
  }

  /** Moves the pointer off everything the app draws, as onto the window's edge. */
  unhover(): void {
    const from = this.#hovered
    if (from === null || !from.isConnected) { this.#hovered = null; return }
    for (const type of ['pointerout', 'mouseout']) this.#mouse(type, from, { relatedTarget: null })
    for (let node: El | null = from; node !== null; node = node.parentElement) node.removeAttribute(HOVER_ATTRIBUTE)
    for (let node: El | null = from; node !== null; node = node.parentElement) for (const type of ['pointerleave', 'mouseleave']) this.#mouse(type, node, { relatedTarget: null })
    this.#hovered = null
  }

  #modifiers(modifiers: ReadonlyArray<Modifier> = []): Record<string, boolean> {
    return Object.fromEntries(Object.entries(MODIFIERS).map(([name, field]) => [field, modifiers.includes(name as Modifier)]))
  }

  /** Mouse down and up on `el`, then a click, as a real press sends them; the press focuses what it lands in. */
  click(el: El, modifiers?: ReadonlyArray<Modifier>, detail = 1): void {
    const init = { ...this.#modifiers(modifiers), detail }
    this.#pointerFocus(true)
    this.hover(el)
    const down = this.#mouse('pointerdown', el, { ...init, buttons: 1 }) && this.#mouse('mousedown', el, { ...init, buttons: 1 })
    if (down) this.#focusFrom(el)
    this.#mouse('pointerup', el, init)
    this.#mouse('mouseup', el, init)
    this.#mouse('click', el, init)
    if (detail === 2) this.#mouse('dblclick', el, { ...init, detail: 2 })
    this.#activate(el)
  }

  /** A right press: down, up and `contextmenu`, as Chromium sends them on a Mac. */
  rightClick(el: El, modifiers?: ReadonlyArray<Modifier>): void {
    const init = { ...this.#modifiers(modifiers), button: 2 }
    this.#pointerFocus(true)
    this.hover(el)
    const down = this.#mouse('pointerdown', el, { ...init, buttons: 2 }) && this.#mouse('mousedown', el, { ...init, buttons: 2 })
    if (down) this.#focusFrom(el)
    this.#mouse('pointerup', el, init)
    this.#mouse('mouseup', el, init)
    this.#mouse('contextmenu', el, init)
  }

  /** Focus goes to the nearest focusable element the press landed in, or nowhere. */
  #focusFrom(el: El): void {
    const target = el.closest<El>(TABBABLE)
    if (target !== null && !disabled(target)) target.focus()
    else this.active?.blur()
  }

  /** What a click on a label or a checkbox does by itself. */
  #activate(el: El): void {
    const label = el.closest('label')
    if (label !== null && el.closest('input, button, textarea, select') === null) {
      const control = (label as HTMLLabelElement).control as El | null
      if (control !== null && control !== el) control.click()
    }
  }

  /** Sets a field's value as a paste or autofill does: the native setter, then `input`. */
  fill(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
    if (this.active !== el) el.focus()
    this.#setValue(el, text, text.length, 'insertReplacementText', text)
  }

  #setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string, caret: number, inputType: string, data: string | null): void {
    const W = this.window as unknown as { HTMLTextAreaElement: typeof HTMLTextAreaElement; HTMLInputElement: typeof HTMLInputElement; InputEvent: typeof InputEvent }
    const proto = el.tagName === 'TEXTAREA' ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    try { el.setSelectionRange(caret, caret) } catch { /* a field with no selection, as a number */ }
    el.dispatchEvent(new W.InputEvent('input', { bubbles: true, inputType, data }))
  }

  /** Types into the focused element, a key at a time. */
  async type(text: string): Promise<void> {
    for (const char of text) {
      await this.press(char)
      await new Promise((done) => setTimeout(done, 0))
    }
  }

  /** Keys on the focused element, `+`-joined as Playwright names them: `Enter`, `Meta+Enter`, `Shift+Tab`, `Meta+3`. */
  async press(keys: string): Promise<void> {
    const parts = keys === '+' ? ['+'] : keys.split('+')
    const key = parts.at(-1) === '' ? '+' : parts.at(-1)!
    const modifiers = parts.slice(0, -1).filter((part): part is Modifier => part in MODIFIERS)
    this.key(this.active ?? this.document.body as El, key === 'Space' ? ' ' : key, modifiers)
    await Promise.resolve()
  }

  /**
   * keydown, the browser's default action unless the page prevented it,
   * then keyup. Answers whether the keydown was let through.
   */
  key(el: El, key: string, modifiers: ReadonlyArray<Modifier> = []): boolean {
    const kept = this.#keydown(el, key, modifiers)
    this.#keyup(this.active ?? el, key, modifiers)
    return kept
  }

  /** Presses `key` (`Alt`, `Space`) on the focused element and keeps it down until `up`; a held modifier joins later keys' events. */
  down(key: string): void {
    const name = key === 'Space' ? ' ' : key
    const modifiers = [...this.#held].filter((held): held is Modifier => held in MODIFIERS)
    if (name in MODIFIERS) modifiers.push(name as Modifier)
    this.#held.add(name)
    this.#keydown(this.active ?? this.document.body as El, name, modifiers)
  }

  up(key: string): void {
    const name = key === 'Space' ? ' ' : key
    this.#held.delete(name)
    this.#keyup(this.active ?? this.document.body as El, name, [...this.#held].filter((held): held is Modifier => held in MODIFIERS))
  }

  #keyInit(key: string, modifiers: ReadonlyArray<Modifier>) {
    return { key, code: codeOf(key), bubbles: true, cancelable: true, composed: true, ...this.#modifiers(modifiers) }
  }

  #keydown(el: El, key: string, modifiers: ReadonlyArray<Modifier>): boolean {
    const K = (this.window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent
    this.#pointerFocus(false)
    const kept = el.dispatchEvent(new K('keydown', this.#keyInit(key, modifiers)))
    if (kept) this.#defaultAction(el, key, modifiers)
    return kept
  }

  #keyup(el: El, key: string, modifiers: ReadonlyArray<Modifier>): void {
    const K = (this.window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent
    el.dispatchEvent(new K('keyup', this.#keyInit(key, modifiers)))
  }

  #defaultAction(el: El, key: string, modifiers: ReadonlyArray<Modifier>): void {
    const field = /^(INPUT|TEXTAREA)$/.test(el.tagName) ? (el as HTMLInputElement) : undefined
    const command = modifiers.includes('Meta') || modifiers.includes('Control')
    if (key === 'Tab') return this.#tab(el, modifiers.includes('Shift'))
    if (field !== undefined && !command) return this.#edit(field, key)
    if ((key === 'Enter' || key === ' ') && !command && (el.tagName === 'BUTTON' || roleOf(el) === 'button' || (el.tagName === 'A' && key === 'Enter'))) {
      // A keyboard click has detail 0; the app treats it as one.
      const M = (this.window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent
      el.dispatchEvent(new M('click', { bubbles: true, cancelable: true, composed: true, detail: 0, ...this.#modifiers(modifiers) }))
    }
  }

  #edit(field: HTMLInputElement | HTMLTextAreaElement, key: string): void {
    const start = field.selectionStart ?? field.value.length
    const end = field.selectionEnd ?? start
    const value = field.value
    const caret = (at: number) => field.setSelectionRange(at, at)
    if (key === 'ArrowLeft') return caret(Math.max(0, start === end ? start - 1 : start))
    if (key === 'ArrowRight') return caret(Math.min(value.length, start === end ? end + 1 : end))
    if (key === 'Home' || key === 'ArrowUp' && field.tagName === 'INPUT') return caret(0)
    if (key === 'End' || key === 'ArrowDown' && field.tagName === 'INPUT') return caret(value.length)
    const insert = key.length === 1 ? key : key === 'Enter' && field.tagName === 'TEXTAREA' ? '\n' : undefined
    const remove: readonly [number, number] | undefined = key === 'Backspace' ? (start === end ? [Math.max(0, start - 1), end] : [start, end]) : key === 'Delete' ? (start === end ? [start, Math.min(value.length, end + 1)] : [start, end]) : undefined
    if (insert === undefined && (remove === undefined || remove[0] === remove[1])) return
    const I = (this.window as unknown as { InputEvent: typeof InputEvent }).InputEvent
    const inputType = insert === '\n' ? 'insertLineBreak' : insert !== undefined ? 'insertText' : key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward'
    if (!field.dispatchEvent(new I('beforeinput', { bubbles: true, cancelable: true, inputType, data: insert ?? null }))) return
    const [from, to] = remove ?? [start, end]
    this.#setValue(field, value.slice(0, from) + (insert ?? '') + value.slice(to), from + (insert?.length ?? 0), inputType, insert ?? null)
  }

  /** Tab moves focus to the next element in the Tab order, in document order with tabindex 0 or none; Shift+Tab back. */
  #tab(from: El, back: boolean): void {
    const order = [...this.document.querySelectorAll<El>(TABBABLE)].filter((el) => {
      const index = el.getAttribute('tabindex')
      if (index !== null && Number(index) < 0) return false
      if (el.tagName === 'A' && !el.hasAttribute('href') && index === null) return false
      if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') return false
      return !disabled(el) && shown(el)
    })
    const at = order.indexOf(from)
    const next = back ? order[at === -1 ? order.length - 1 : at - 1] : order[at + 1]
    if (next !== undefined) next.focus()
  }
}

/**
 * A happy-dom window that runs the renderer bundle (`vite.config.ts`). Each
 * window is its own VM context, so the renderer's module state is new for
 * every test and every relaunch. What happy-dom leaves out and the app calls
 * is filled in here, each answering as an unhidden, laid-out page would:
 * a test whose assertion depends on one of these belongs in Playwright
 * (README, "The rule").
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Script } from 'node:vm'
import { Window } from 'happy-dom'
import type { PageClock } from './clock'

export const DOM_BUILD = resolve(__dirname, 'dist')

let compiled: { readonly script: Script; readonly css: string } | undefined
/** Compiled once per Bun worker; each window runs it in its own context. */
function renderer() {
  compiled ??= { script: new Script(readFileSync(join(DOM_BUILD, 'renderer.js'), 'utf8'), { filename: 'renderer.js' }), css: rootRules(readFileSync(join(DOM_BUILD, 'style.css'), 'utf8')) }
  return compiled
}

/**
 * The sheet's rules for the root (`:root`, `html`): the tokens, such as the
 * durations `rootDuration` reads. happy-dom matches every rule of every
 * sheet against an element and its ancestors on each `getComputedStyle`,
 * which the app calls in layout effects, and the class rules only give
 * values that need layout to mean anything (README, "The rule").
 */
function rootRules(css: string): string {
  const parser = new Window()
  try {
    const sheet = new parser.CSSStyleSheet()
    sheet.replaceSync(css)
    // A rule whose subject, the compound after the last combinator, is the root.
    const forRoot = (selector: string) => selector.split(',').some((part) => { const subject = part.trim().split(/[\s>+~]+/).at(-1) ?? ''; return /:root\b/.test(subject) || /^html\b/.test(subject) })
    const keep = (rules: CSSRuleList): string => [...rules].map((rule) => {
      if ('selectorText' in rule) return forRoot(String(rule.selectorText)) ? rule.cssText : ''
      if ('conditionText' in rule && 'cssRules' in rule) {
        const inner = keep(rule.cssRules as CSSRuleList)
        return inner === '' ? '' : `@${rule.constructor.name === 'CSSSupportsRule' ? 'supports' : 'media'} ${String(rule.conditionText)} {${inner}}`
      }
      return ''
    }).join('')
    return keep(sheet.cssRules as unknown as CSSRuleList)
  } finally {
    void parser.happyDOM.close()
  }
}

const quiet = Object.fromEntries(['log', 'info', 'debug', 'trace', 'group', 'groupCollapsed', 'groupEnd', 'table', 'dir', 'time', 'timeEnd', 'timeLog', 'count', 'assert'].map((name) => [name, () => {}]))

/** Opens `url` in a new window and runs the renderer in it. The page's errors and warnings reach the test output; JUNO_DOM_DEBUG=1 passes everything. */
export function openWindow(url: string, clock?: PageClock, engineClock?: Parameters<PageClock['install']>[1]): Window {
  const window = new Window({
    url,
    width: 1200,
    height: 800,
    console: process.env['JUNO_DOM_DEBUG'] === '1' ? globalThis.console : ({ ...quiet, error: (...args: unknown[]) => console.error('[page]', ...args), warn: (...args: unknown[]) => console.warn('[page]', ...args) } as unknown as Console),
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' },
    },
  })
  patchPrototypes(window)
  restorePrototypes(window)
  fillGaps(window)
  // The sidebar trace (e2e README, "Sidebar trace") on: the driver waits for the list value a filter asks for.
  ;(window as unknown as Record<string, unknown>)['__junoSidebarTrace'] = { hold: [], list: { values: 0, errors: 0 } }
  clock?.install(window, engineClock)
  const { script, css } = renderer()
  window.document.write(`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div></body></html>`)
  script.runInContext(window as never)
  return window
}

/** A CSS escape (`\\31 7`, `\\.`) inside a quoted string, as the browser reads it. */
const unescapeString = (text: string) => text.replace(/\\([0-9a-fA-F]{1,6}) ?|\\(.)/g, (_all, hex: string | undefined, char: string | undefined) => (hex === undefined ? char! : String.fromCodePoint(Number.parseInt(hex, 16))))
const unescapeQuoted = (selector: string) => (selector.includes('\\') ? selector.replace(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g, (_all, double: string | undefined, single: string | undefined) => JSON.stringify(unescapeString(double ?? single ?? ''))) : selector)

/**
 * happy-dom matches a quoted attribute value as written, escapes and all, so
 * `[data-message-row="${CSS.escape(ts)}"]` (the app's `rowOf`) finds nothing.
 * Selectors are unescaped inside their quotes before happy-dom reads them.
 */
function unescapeSelectors(window: Window): void {
  const W = window as unknown as Record<string, { prototype: object }>
  const patched = new Set<object>()
  for (const type of ['Element', 'Document', 'DocumentFragment']) {
    for (const name of ['querySelector', 'querySelectorAll', 'matches', 'closest']) {
      // The prototype that defines it, which several types can share.
      let owner: object | null = W[type]!.prototype
      while (owner !== null && !Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner) as object | null
      if (owner === null) continue
      const key = Object.getOwnPropertyDescriptor(owner, name)!.value as object
      if (patched.has(key)) continue
      patched.add(key)
      const original = key as (this: unknown, selector: string) => unknown
      const wrapped = function (this: unknown, selector: string) {
        return original.call(this, unescapeQuoted(selector))
      }
      patched.add(wrapped)
      ;(owner as Record<string, unknown>)[name] = wrapped
    }
  }
}

/**
 * A MessageChannel whose ports are this window's event targets, so the page
 * can dispatch its own events on them (`web/page/agent.ts` does). A message
 * arrives a task later, cloned, once its port is started; a test clock does
 * not hold it.
 */
function messageChannel(window: Window): new () => { readonly port1: EventTarget; readonly port2: EventTarget } {
  const W = window as unknown as { EventTarget: typeof EventTarget; MessageEvent: typeof MessageEvent }
  class Port extends W.EventTarget {
    other: Port | undefined
    #started = false
    #closed = false
    readonly #queue: unknown[] = []
    #onmessage: ((event: MessageEvent) => void) | null = null

    get onmessage(): ((event: MessageEvent) => void) | null {
      return this.#onmessage
    }

    set onmessage(handler: ((event: MessageEvent) => void) | null) {
      if (this.#onmessage !== null) this.removeEventListener('message', this.#onmessage as EventListener)
      this.#onmessage = handler
      if (handler !== null) this.addEventListener('message', handler as EventListener)
      this.start()
    }

    postMessage(data: unknown): void {
      const other = this.other
      if (this.#closed || other === undefined) return
      const copy = structuredClone(data)
      // Bun's timer, not the page's, which a test clock may hold.
      setImmediate(() => other.receive(copy))
    }

    receive(data: unknown): void {
      if (this.#closed) return
      if (!this.#started) return void this.#queue.push(data)
      this.dispatchEvent(new W.MessageEvent('message', { data }))
    }

    start(): void {
      if (this.#started) return
      this.#started = true
      for (const data of this.#queue.splice(0)) this.receive(data)
    }

    close(): void {
      this.#closed = true
    }
  }
  return class {
    readonly port1 = new Port()
    readonly port2 = new Port()

    constructor() {
      this.port1.other = this.port2
      this.port2.other = this.port1
    }
  }
}

/** No `hidden` or inline `display: none` (React's Activity) on the element or above it. */
function unhidden(el: HTMLElement): boolean {
  if (el.hidden || el.style?.display === 'none') return false
  return el.parentElement === null || unhidden(el.parentElement)
}

let prototypesPatched = false

/**
 * happy-dom's element classes are shared by every window, so their gaps are
 * filled once per worker, and what depends on the window is read from the
 * element's own.
 */
function patchPrototypes(window: Window): void {
  if (prototypesPatched) return
  prototypesPatched = true
  unescapeSelectors(window)
  const proto = (window as unknown as { Element: typeof Element }).Element.prototype as unknown as Record<string, unknown>
  proto['checkVisibility'] ??= function (this: HTMLElement) {
    return unhidden(this)
  }
  // happy-dom matches :focus-visible on any focus. Browsers match it after keyboard input, not after a press (`Dom` keeps which).
  const matches = proto['matches'] as (this: Element, selector: string) => boolean
  proto['matches'] = function (this: Element, selector: string) {
    if (selector === ':focus-visible') return this === this.ownerDocument.activeElement && (this.ownerDocument.defaultView as { __domPointerFocus?: boolean } | null)?.__domPointerFocus !== true
    return matches.call(this, selector)
  }
  for (const name of ['scrollIntoView', 'scrollTo', 'scrollBy']) proto[name] ??= function () {}
  proto['animate'] ??= function () {
    return { finished: Promise.resolve(), cancel() {}, finish() {}, play() {}, pause() {}, reverse() {}, onfinish: null, addEventListener(type: string, listener: () => void) { if (type === 'finish') queueMicrotask(listener) }, removeEventListener() {}, currentTime: 0, playState: 'finished' }
  }
  proto['getAnimations'] ??= function () { return [] }
}

let pristine: Map<object, PropertyDescriptorMap> | undefined

/**
 * Puts the shared prototypes back as they were before any page ran. A page
 * patches them as if they were its own (`web/page/urls.ts` wraps
 * `setAttribute`), so without this each window would wrap the last one's
 * patch, every call would go through all of them, and the wrappers would
 * keep every closed window alive. Runs before each page and after it closes;
 * the first run records the prototypes as `patchPrototypes` leaves them.
 */
function restorePrototypes(window: Window): void {
  pristine ??= sharedPrototypes(window)
  for (const [proto, descriptors] of pristine) {
    const target = proto as Record<PropertyKey, unknown>
    for (const key of Reflect.ownKeys(proto)) {
      const before = descriptors[key as string]
      if (before === undefined) delete target[key]
      else {
        const now = Object.getOwnPropertyDescriptor(proto, key)!
        if (now.value !== before.value || now.get !== before.get || now.set !== before.set) Object.defineProperty(proto, key, before)
      }
    }
    for (const key of Reflect.ownKeys(descriptors)) if (!Object.hasOwn(proto, key)) Object.defineProperty(proto, key, descriptors[key as string]!)
  }
}

/** Every prototype the window's classes share with other windows (this realm's, not the window's own built-ins), with its properties now. */
function sharedPrototypes(window: Window): Map<object, PropertyDescriptorMap> {
  const found = new Map<object, PropertyDescriptorMap>()
  const globals = window as unknown as Record<string, unknown>
  for (const name of Object.getOwnPropertyNames(window)) {
    const value = typeof Object.getOwnPropertyDescriptor(window, name)?.value === 'function' ? (globals[name] as { prototype?: unknown }).prototype : undefined
    for (let proto = value; proto instanceof Object && !found.has(proto); proto = Object.getPrototypeOf(proto)) found.set(proto, Object.getOwnPropertyDescriptors(proto))
  }
  return found
}

/** Closes a window from `openWindow` and undoes what its page did to the shared prototypes. */
export async function closeWindow(window: Window): Promise<void> {
  try {
    await window.happyDOM.close()
  } finally {
    restorePrototypes(window)
  }
}

function fillGaps(window: Window): void {
  const globals = window as unknown as Record<string, unknown>
  // Bun's own, which talk to the host for real.
  for (const name of ['WebSocket', 'structuredClone', 'BroadcastChannel']) if (globals[name] === undefined) globals[name] = (globalThis as Record<string, unknown>)[name]
  if (globals['MessageChannel'] === undefined) globals['MessageChannel'] = messageChannel(window)
  if (globals['requestIdleCallback'] === undefined) {
    globals['requestIdleCallback'] = (callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) => (window.setTimeout as unknown as (run: () => void, delay: number) => number)(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1)
    globals['cancelIdleCallback'] = (id: number) => (window.clearTimeout as unknown as (id: number) => void)(id)
  }
  const document = window.document as unknown as Record<string, unknown>
  if (document['timeline'] === undefined) Object.defineProperty(document, 'timeline', { value: { get currentTime() { return window.performance.now() } } })
  ;(document as { getAnimations?: () => unknown[] }).getAnimations ??= () => []
}

/**
 * A happy-dom window that runs the renderer bundle (`vite.config.ts`). The
 * bundle runs in one VM context per Bun worker (`Realm`), so the code JSC
 * has compiled and optimised carries from test to test; each window gets
 * the bundle's module state new, and its globals are that window's. What
 * happy-dom leaves out and the app calls is filled in here, each answering
 * as an unhidden, laid-out page would: a test whose assertion depends on
 * one of these belongs in Playwright (README, "The rule").
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createContext, runInContext, Script } from 'node:vm'
import { Window } from 'happy-dom'
import type { PageClock } from './clock'

export const DOM_BUILD = resolve(__dirname, 'dist')

/**
 * The renderer's realm. JSC keeps compiled and optimised code per VM
 * context, so a bundle run in each window's own context ran cold in every
 * test. Here the bundle is one function, compiled once in a context of its
 * own, and each window calls it: its modules start new, as on a page load,
 * and every global the bundle names is a variable bound to that window's
 * value (`document`, `setTimeout`, `globalThis`), so a closed page's late
 * callbacks still reach only its own window, and two windows (`otherApp`)
 * run side by side. JavaScript's own globals (`Array`, `Promise`, `Map`)
 * are the realm's, on the window too, except one a test replaced on the
 * window (the clock's `Date`). A global the page replaces on the window
 * later (`window.fetch`) follows (`follow`); one it adds that the window
 * did not have is read as `window.name`.
 *
 * What the realm itself holds is checked after every page (`checkRealm`).
 */
interface Realm {
  /** Runs the bundle for `window`. */
  readonly start: (window: Window, language: Readonly<Record<string, unknown>>) => void
  readonly global: Record<string, unknown>
  /** The realm's own globals and JavaScript's objects, as they were before any page ran. */
  readonly pristine: Map<object, PropertyDescriptorMap>
  readonly labels: Map<object, string>
}

let realm: Realm | undefined
let css: string | undefined

/** JavaScript's own globals, as a new VM context has them. `console` is the window's. */
const LANGUAGE = (runInContext('Object.getOwnPropertyNames(globalThis)', createContext({})) as string[]).filter((name) => name !== 'console' && name !== 'globalThis')
/** Bound as variables in the bundle: everything but the ones a function cannot declare or that change how code runs. */
const LANGUAGE_BOUND = LANGUAGE.filter((name) => !['undefined', 'NaN', 'Infinity', 'eval'].includes(name))
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const RESERVED = new Set(['arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield'])

/** The globals a window gives its page: its own properties and its classes', less JavaScript's and `Object.prototype`'s. */
function windowGlobals(window: Window): string[] {
  const names = new Set<string>(['globalThis'])
  for (let proto: object | null = window; proto !== null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
    for (const name of Object.getOwnPropertyNames(proto)) if (IDENTIFIER.test(name) && !RESERVED.has(name) && !LANGUAGE.includes(name) && !(name in Object.prototype)) names.add(name)
  }
  return [...names]
}

/** Compiles the bundle in a new context, with the globals of `window` (the worker's first, or a probe) as its variables. */
function makeRealm(window: Window): Realm {
  const fromWindow = windowGlobals(window)
  const source = readFileSync(join(DOM_BUILD, 'renderer.js'), 'utf8')
  const bind = [...fromWindow.map((name, at) => `${name} = $w[${at}]`), ...LANGUAGE_BOUND.map((name, at) => `${name} = $l[${at}]`)].join(', ')
  const setters = fromWindow.map((name) => `(v) => { ${name} = v }`).join(', ')
  // One line before the bundle, so its stack lines keep the bundle's numbers (`callers`).
  const script = new Script(`(function ($w, $l, $set) { var ${bind}; $set([${setters}]);\n${source}\n})`, { filename: 'renderer.js', lineOffset: -1 })
  const context = createContext({})
  const run = script.runInContext(context) as (fromWindow: unknown[], language: unknown[], set: (setters: ReadonlyArray<(value: unknown) => void>) => void) => void
  const global = runInContext('globalThis', context) as Record<string, unknown>
  const own = Object.fromEntries(LANGUAGE.map((name) => [name, global[name]]))
  const labels = new Map<object, string>([[global, 'globalThis']])
  // The realm's objects are not `instanceof` this realm's `Object`.
  const isObject = (value: unknown): value is object => (typeof value === 'object' && value !== null) || typeof value === 'function'
  for (const name of LANGUAGE) {
    const value = own[name]
    if (!isObject(value)) continue
    if (!labels.has(value)) labels.set(value, name)
    const proto = (value as { prototype?: unknown }).prototype
    if (isObject(proto) && !labels.has(proto)) labels.set(proto, `${name}.prototype`)
  }
  for (const [object, label] of [...labels]) {
    // Prototypes with no global of their own: functions', iterators', generators'.
    const above = Object.getPrototypeOf(object) as object | null
    if (above !== null && !labels.has(above)) labels.set(above, `${label}'s prototype`)
  }
  return {
    start: (page, language) => {
      const globals = page as unknown as Record<string, unknown>
      // `window.Uint8Array` is the bundle's `Uint8Array`, as in a browser (Effect's Schema checks `globalThis.Uint8Array`).
      for (const name of LANGUAGE) {
        if (globals[name] !== language[name]) continue
        const descriptor = Object.getOwnPropertyDescriptor(page, name)
        Object.defineProperty(page, name, { ...(descriptor ?? { writable: true, configurable: true, enumerable: false }), value: own[name] })
      }
      run(fromWindow.map((name) => (name === 'globalThis' ? page : globals[name])), LANGUAGE_BOUND.map((name) => (globals[name] !== language[name] ? globals[name] : own[name])), (setters) => follow(page, fromWindow, setters))
    },
    global,
    pristine: new Map([...labels.keys()].map((object) => [object, Object.getOwnPropertyDescriptors(object)])),
    labels,
  }
}

/**
 * Keeps the bundle's variables in step with the window: a global the page
 * sets on the window after it starts (`urls.ts` replaces `window.fetch`) is
 * what its bare name reads from then on. Each writable value becomes an
 * accessor on the window that sets the variable too.
 */
function follow(page: Window, names: ReadonlyArray<string>, setters: ReadonlyArray<(value: unknown) => void>): void {
  names.forEach((name, at) => {
    if (name === 'globalThis') return
    let owner: object | null = page
    while (owner !== null && !Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner) as object | null
    const descriptor = owner === null ? undefined : Object.getOwnPropertyDescriptor(owner, name)
    if (descriptor === undefined || !('value' in descriptor) || descriptor.writable !== true || (owner === page && descriptor.configurable !== true)) return
    let value: unknown = descriptor.value
    Object.defineProperty(page, name, {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      get: () => value,
      set: (next: unknown) => {
        value = next
        setters[at]!(next)
      },
    })
  })
}

/**
 * Fails when a page has left something in the realm the next page would
 * see: a global set through the realm's own `globalThis` (a sloppy `this`,
 * `Function('return this')()`), or a property of a JavaScript object or
 * prototype added, removed or replaced (`Error.stackTraceLimit`, a
 * polyfill). The realm is dropped, so the tests after run in a new one.
 */
function checkRealm(): void {
  const current = realm
  if (current === undefined) return
  for (const [object, before] of current.pristine) {
    const keys = new Set([...Reflect.ownKeys(object), ...Reflect.ownKeys(before)])
    for (const key of keys) {
      const was = before[key as string]
      const now = Object.getOwnPropertyDescriptor(object, key)
      // RegExp's legacy statics (`RegExp.$1`, `lastMatch`) are accessors whose value follows the last match.
      if (was !== undefined && now !== undefined && Object.is(now.value, was.value) && now.get === was.get && now.set === was.set) continue
      realm = undefined
      throw new Error(`This page left ${current.labels.get(object)}.${String(key)} ${now === undefined ? 'removed' : was === undefined ? 'added' : 'changed'} in the renderer's realm, which every later page in the worker shares (window.ts, "Realm"). Set it on the window, or put it back when the page closes.`)
    }
  }
}

/** The sheet's root rules, read once per worker. */
function rootSheet(): string {
  return css ??= rootRules(readFileSync(join(DOM_BUILD, 'style.css'), 'utf8'))
}

/** Compiles the renderer in its realm and reads its sheet ahead of the first window, from a window that runs nothing. */
export function warmRenderer(): void {
  rootSheet()
  if (realm !== undefined) return
  const probe = new Window()
  try {
    fillGaps(probe)
    ;(probe as unknown as Record<string, unknown>)['__junoSidebarTrace'] = undefined
    realm = makeRealm(probe)
  } finally { void probe.happyDOM.close() }
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

/**
 * Opens `url` in a new window and runs the renderer in it, with `storage` in
 * its localStorage first. The page's errors and warnings reach the test
 * output; JUNO_DOM_DEBUG=1 passes everything.
 */
export function openWindow(url: string, clock?: PageClock, engineClock?: Parameters<PageClock['install']>[1], storage: ReadonlyArray<readonly [string, string]> = []): Window {
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
  // JavaScript's globals as the window made them, before the gaps and the clock replace any.
  const language = Object.fromEntries(LANGUAGE.map((name) => [name, (window as unknown as Record<string, unknown>)[name]]))
  patchPrototypes(window)
  if (open.size === 0) restorePrototypes(window)
  open.add(window)
  fillGaps(window)
  // The sidebar trace (e2e README, "Sidebar trace") on: the driver waits for the list value a filter asks for.
  ;(window as unknown as Record<string, unknown>)['__junoSidebarTrace'] = { hold: [], list: { values: 0, errors: 0 } }
  clock?.install(window, engineClock)
  for (const [key, value] of storage) window.localStorage.setItem(key, value)
  window.document.write(`<!doctype html><html><head><style>${rootSheet()}</style></head><body><div id="root"></div></body></html>`)
  warmRenderer()
  realm!.start(window, language)
  return window
}

/** A CSS escape (`\\31 7`, `\\.`) inside a quoted string, as the browser reads it. */
const unescapeString = (text: string) => text.replace(/\\([0-9a-fA-F]{1,6}) ?|\\(.)/g, (_all, hex: string | undefined, char: string | undefined) => (hex === undefined ? char! : String.fromCodePoint(Number.parseInt(hex, 16))))
const unescapeQuoted = (selector: string) => (selector.includes('\\') ? selector.replace(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g, (_all, double: string | undefined, single: string | undefined) => JSON.stringify(unescapeString(double ?? single ?? ''))) : selector)

/** The attribute `Dom` keeps on the element under the pointer and its ancestors, which `:hover` reads here. */
export const HOVER_ATTRIBUTE = 'data-dom-hover'

const withHover = (selector: string) => (selector.includes(':hover') ? selector.replaceAll(':hover', `[${HOVER_ATTRIBUTE}]`) : selector)

/**
 * happy-dom matches a quoted attribute value as written, escapes and all, so
 * `[data-message-row="${CSS.escape(ts)}"]` (the app's `rowOf`) finds nothing.
 * Selectors are unescaped inside their quotes before happy-dom reads them.
 * happy-dom has no pointer, so `:hover` reads the elements `Dom.hover` marked.
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
        return original.call(this, withHover(unescapeQuoted(selector)))
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
      if (this.#closed || closed.has(window)) return
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

const FOCUS_LOG = Symbol('focusLog')
interface FocusMove {
  readonly name: string
  readonly element: HTMLElement
  readonly by: string
}

/** The page's own functions on the stack, nearest first. */
function callers(): string {
  return (new Error().stack ?? '').split('\n').filter((line) => line.includes('renderer.js')).slice(0, 4).map((line) => line.trim().replace(/^at /, '').replace(/ \(.*$/, '')).join(' < ')
}

/** The last focus() and blur() calls in `window`, oldest first, and whether each element is still in the page. */
export function focusLog(window: object): string {
  const log = (window as { [FOCUS_LOG]?: FocusMove[] })[FOCUS_LOG] ?? []
  return log.map(({ name, element, by }) => `${name} ${element.outerHTML.slice(0, 80)}${element.isConnected ? '' : ' (since removed)'} by ${by || 'the test'}`).join('\n  ')
}

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
  // Each focus() and blur() with the page functions that called it, for a failed `toBeFocused` to show (`focusLog`).
  const html = (window as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement.prototype as unknown as Record<string, unknown>
  for (const name of ['focus', 'blur']) {
    const original = html[name] as (this: HTMLElement, ...args: unknown[]) => void
    html[name] = function (this: HTMLElement, ...args: unknown[]) {
      const view = this.ownerDocument.defaultView as { [FOCUS_LOG]?: FocusMove[] } | null
      if (view !== null) {
        const log = (view[FOCUS_LOG] ??= [])
        log.push({ name, element: this, by: callers() })
        if (log.length > 12) log.shift()
      }
      return original.apply(this, args)
    }
  }
  // A browser sets `window.event` while an event's listeners run, and React reads it: an update from a native
  // keydown or click listener is then discrete and renders at once, before any timer. happy-dom leaves it unset.
  const target = (window as unknown as { EventTarget: typeof EventTarget }).EventTarget.prototype as unknown as Record<string, unknown>
  const dispatchEvent = target['dispatchEvent'] as (this: EventTarget, event: Event) => boolean
  target['dispatchEvent'] = function (this: EventTarget, event: Event) {
    const node = this as unknown as { ownerDocument?: Document | null; defaultView?: unknown; document?: unknown }
    const view = (node.document !== undefined ? node : node.defaultView ?? node.ownerDocument?.defaultView) as { event?: Event } | null | undefined
    if (view === null || view === undefined) return dispatchEvent.call(this, event)
    const outer = view.event
    view.event = event
    try {
      return dispatchEvent.call(this, event)
    } finally { view.event = outer }
  }
}

let pristine: Map<object, PropertyDescriptorMap> | undefined
const open = new Set<Window>()

/**
 * Puts the shared prototypes back as they were before any page ran. A page
 * patches them as if they were its own (`web/page/urls.ts` wraps
 * `setAttribute`), so without this each window would wrap the last one's
 * patch, every call would go through all of them, and the wrappers would
 * keep every closed window alive. Runs before a page when no other is open
 * (`otherApp` opens a second) and after the last one closes; the first run
 * records the prototypes as `patchPrototypes` leaves them.
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

/** Windows `closeWindow` has closed, and each window's open sockets. */
const closed = new WeakSet<Window>()
const sockets = new WeakMap<Window, Set<WebSocket>>()

/**
 * Bun's WebSocket, which happy-dom does not know about: each one is kept so
 * `closeWindow` closes it, and a closed page cannot open another. Left open,
 * a closed page keeps receiving, rendering and asking its host, and the
 * worker's pooled host serves the next test on the same port.
 */
function pageSocket(window: Window): typeof WebSocket {
  const live = new Set<WebSocket>()
  sockets.set(window, live)
  return class PageSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      if (closed.has(window)) throw new Error(`This page has closed; it cannot connect to ${new URL(url).pathname}`)
      super(url, protocols)
      live.add(this)
      this.addEventListener('close', () => live.delete(this))
    }
  }
}

/** Closes a window from `openWindow`, its sockets first, and undoes what its page did to the shared prototypes. */
export async function closeWindow(window: Window): Promise<void> {
  closed.add(window)
  for (const socket of sockets.get(window) ?? []) socket.close()
  try {
    await window.happyDOM.close()
  } finally {
    open.delete(window)
    if (open.size === 0) restorePrototypes(window)
  }
  checkRealm()
}

function fillGaps(window: Window): void {
  const globals = window as unknown as Record<string, unknown>
  // Bun's own, which talk to the host for real.
  for (const name of ['structuredClone', 'BroadcastChannel']) if (globals[name] === undefined) globals[name] = (globalThis as Record<string, unknown>)[name]
  if (globals['WebSocket'] === undefined) globals['WebSocket'] = pageSocket(window)
  if (globals['MessageChannel'] === undefined) globals['MessageChannel'] = messageChannel(window)
  if (globals['requestIdleCallback'] === undefined) {
    globals['requestIdleCallback'] = (callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) => (window.setTimeout as unknown as (run: () => void, delay: number) => number)(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1)
    globals['cancelIdleCallback'] = (id: number) => (window.clearTimeout as unknown as (id: number) => void)(id)
  }
  const document = window.document as unknown as Record<string, unknown>
  // happy-dom answers from activeElement, which is null once a focused element leaves. A window has focus until it blurs.
  let focused = true
  window.addEventListener('blur', () => { focused = false })
  window.addEventListener('focus', () => { focused = true })
  document['hasFocus'] = () => focused
  if (document['timeline'] === undefined) Object.defineProperty(document, 'timeline', { value: { get currentTime() { return window.performance.now() } } })
  ;(document as { getAnimations?: () => unknown[] }).getAnimations ??= () => []
  document['execCommand'] = (command: string, _ui?: boolean, value?: string) => editFocusedField(window, command, value)
}

/**
 * `execCommand('insertText')` and `('delete')` as Chromium runs them on the focused input or textarea, which is all the
 * composers use (`editField`, Home's held keys): the selection replaced, the caret after it, one `input` event and no
 * `beforeinput`. No undo stack: a check of ⌘Z after such an edit stays in the browser lane.
 */
function editFocusedField(window: Window, command: string, value: string | undefined): boolean {
  const field = window.document.activeElement as unknown as HTMLInputElement | HTMLTextAreaElement | null
  if (field === null || !/^(INPUT|TEXTAREA)$/.test(field.tagName) || (command !== 'insertText' && command !== 'delete')) return false
  const end = field.selectionEnd ?? field.value.length
  let start = field.selectionStart ?? end
  const text = command === 'insertText' ? value ?? '' : ''
  // A delete with nothing selected takes the character before the caret.
  if (command === 'delete' && start === end) start = Math.max(0, start - (/[\uDC00-\uDFFF]/.test(field.value[start - 1] ?? '') ? 2 : 1))
  const W = window as unknown as { HTMLTextAreaElement: typeof HTMLTextAreaElement; HTMLInputElement: typeof HTMLInputElement; InputEvent: typeof InputEvent }
  const proto = field.tagName === 'TEXTAREA' ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, field.value.slice(0, start) + text + field.value.slice(end))
  field.setSelectionRange(start + text.length, start + text.length)
  field.dispatchEvent(new W.InputEvent('input', { bubbles: true, inputType: command === 'insertText' ? 'insertText' : 'deleteContentBackward', data: command === 'insertText' ? text : null }))
  return true
}

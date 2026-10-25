/**
 * The DOM lane renderer's realm (README, "The rule"). JSC keeps compiled
 * and optimised code per VM context, so a bundle run in each window's own
 * context ran cold in every test. Here the bundle is one function, compiled once in a context of its
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
import { createContext, runInContext, Script } from 'node:vm'
import type { Window } from 'happy-dom'

interface Realm {
  /** Runs the bundle for `window`. */
  readonly start: (window: Window, language: Readonly<Record<string, unknown>>) => void
  readonly global: Record<string, unknown>
  /** The realm's own globals and JavaScript's objects, as they were before any page ran. */
  readonly pristine: Map<object, PropertyDescriptorMap>
  readonly labels: Map<object, string>
}

let realm: Realm | undefined

/** JavaScript's own globals, as a new VM context has them. `console` is the window's. */
export const LANGUAGE = (runInContext('Object.getOwnPropertyNames(globalThis)', createContext({})) as string[]).filter((name) => name !== 'console' && name !== 'globalThis')
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
function makeRealm(window: Window, source: string): Realm {
  const fromWindow = windowGlobals(window)
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
  for (const [object, label] of labels) {
    // Prototypes with no global of their own (functions', iterators', generators'), up each chain.
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
export function checkRealm(): void {
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
      throw new Error(`This page left ${current.labels.get(object)}.${String(key)} ${now === undefined ? 'removed' : was === undefined ? 'added' : 'changed'} in the renderer's realm, which every later page in the worker shares (dom/realm.ts). Set it on the window, or put it back when the page closes.`)
    }
  }
}

/** Compiles `source` (the renderer bundle) in the worker's realm, with the globals `probe` has, unless it is compiled already. */
export function prepareRealm(probe: () => Window, source: () => string): void {
  if (realm !== undefined) return
  const window = probe()
  try {
    realm = makeRealm(window, source())
  } finally { void window.happyDOM.close() }
}

/** Runs the renderer for `window`; `language` is JavaScript's globals as the window had them before the test changed any. */
export function startRenderer(window: Window, language: Readonly<Record<string, unknown>>): void {
  realm!.start(window, language)
}

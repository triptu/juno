/**
 * Counted work in the DOM lane (docs/performance.md, "Counted budgets"): what
 * the renderer does for an action, counted rather than timed.
 *
 * - React commits and component renders, by component name, from a React
 *   DevTools hook on the window (`onCommitFiberRoot`, which production React
 *   calls too). A component counts as rendered when its function ran in the
 *   commit: mounted, or with React's PerformedWork flag. Subtrees React did
 *   not visit are skipped, as React DevTools does.
 * - Port traffic with the engine host, by RPC route, and with the web
 *   shell's bridge to main, by channel: requests the page sent, live messages
 *   (stream values) and replies it got, and bytes each way, with every number
 *   and run of digits counted at one width, so a later timestamp or a larger
 *   id is not more traffic (`socket.ts`).
 *   The RPC keep-alive is left out: it runs on a timer.
 *
 * In a counted test the page's engine frames reach it one at a time
 * (`serialFrames` in `socket.ts`), so two frames never share a commit by
 * chance of timing, and its `Math.random` is seeded (`seedRandom`), so Home
 * picks the same picture every run.
 */
import type { Window } from 'happy-dom'

export interface Traffic {
  requests: number
  messages: number
  bytesIn: number
  bytesOut: number
}

export interface PageWork {
  readonly commits: number
  readonly renders: number
  readonly byComponent: Readonly<Record<string, number>>
  readonly requests: number
  readonly messages: number
  readonly bytesIn: number
  readonly bytesOut: number
  readonly byRoute: Readonly<Record<string, Readonly<Traffic>>>
}

class Meter {
  /** Channel messages posted and not yet delivered: React's scheduler has work queued (`socket.ts`, `settled`). */
  posts = 0
  commits = 0
  renders = 0
  readonly byComponent = new Map<string, number>()
  readonly byRoute = new Map<string, Traffic>()

  route(tag: string): Traffic {
    let traffic = this.byRoute.get(tag)
    if (traffic === undefined) {
      traffic = { requests: 0, messages: 0, bytesIn: 0, bytesOut: 0 }
      this.byRoute.set(tag, traffic)
    }
    return traffic
  }

  read(): PageWork {
    const byRoute: Record<string, Traffic> = {}
    const total: Traffic = { requests: 0, messages: 0, bytesIn: 0, bytesOut: 0 }
    for (const [tag, traffic] of this.byRoute) {
      byRoute[tag] = { ...traffic }
      for (const key of ['requests', 'messages', 'bytesIn', 'bytesOut'] as const) total[key] += traffic[key]
    }
    return { commits: this.commits, renders: this.renders, byComponent: Object.fromEntries(this.byComponent), ...total, byRoute }
  }
}

const meters = new WeakMap<Window, Meter>()

export function meterOf(window: Window): Meter {
  let meter = meters.get(window)
  if (meter === undefined) {
    meter = new Meter()
    meters.set(window, meter)
  }
  return meter
}

/** The work counted on `window` since `before` (a `pageWork` read). */
export function workSince(window: Window, before: PageWork): PageWork {
  const now = meterOf(window).read()
  const byComponent: Record<string, number> = {}
  for (const [name, count] of Object.entries(now.byComponent)) if (count > (before.byComponent[name] ?? 0)) byComponent[name] = count - (before.byComponent[name] ?? 0)
  const byRoute: Record<string, Traffic> = {}
  for (const [tag, traffic] of Object.entries(now.byRoute)) {
    const was = before.byRoute[tag] ?? { requests: 0, messages: 0, bytesIn: 0, bytesOut: 0 }
    const delta = { requests: traffic.requests - was.requests, messages: traffic.messages - was.messages, bytesIn: traffic.bytesIn - was.bytesIn, bytesOut: traffic.bytesOut - was.bytesOut }
    if (delta.requests + delta.messages + delta.bytesIn + delta.bytesOut > 0) byRoute[tag] = delta
  }
  return {
    commits: now.commits - before.commits,
    renders: now.renders - before.renders,
    byComponent,
    requests: now.requests - before.requests,
    messages: now.messages - before.messages,
    bytesIn: now.bytesIn - before.bytesIn,
    bytesOut: now.bytesOut - before.bytesOut,
    byRoute,
  }
}

export const pageWork = (window: Window): PageWork => meterOf(window).read()

// React's fiber tags for components whose function runs on render, and its PerformedWork flag.
const FUNCTION = 0
const CLASS = 1
const FORWARD_REF = 11
const MEMO = 14
const SIMPLE_MEMO = 15
const COMPONENTS = new Set([FUNCTION, CLASS, FORWARD_REF, MEMO, SIMPLE_MEMO])
const PERFORMED_WORK = 1

interface Fiber {
  readonly tag: number
  readonly type: unknown
  readonly flags: number
  readonly alternate: Fiber | null
  readonly child: Fiber | null
  readonly sibling: Fiber | null
}

type Named = { readonly displayName?: string; readonly name?: string; readonly render?: Named; readonly type?: Named }

function nameOf(fiber: Fiber): string {
  let type = fiber.type as Named | undefined
  if (fiber.tag === MEMO) type = type?.type
  if (type?.render !== undefined) type = type.render
  return type?.displayName ?? (type?.name !== undefined && type.name !== '' ? type.name : 'Anonymous')
}

function countCommit(meter: Meter, current: Fiber): void {
  meter.commits++
  const stack: Array<Fiber> = [current]
  while (stack.length > 0) {
    const fiber = stack.pop()!
    const previous = fiber.alternate
    if (COMPONENTS.has(fiber.tag) && (previous === null || (fiber.flags & PERFORMED_WORK) !== 0)) {
      const name = nameOf(fiber)
      meter.renders++
      meter.byComponent.set(name, (meter.byComponent.get(name) ?? 0) + 1)
    }
    // React kept the children it did not visit: nothing below rendered.
    if (previous !== null && previous.child === fiber.child) continue
    for (let child = fiber.child; child !== null; child = child.sibling) stack.push(child)
  }
}

/** The hook production React reports each commit to, as React DevTools installs it. Set on the window before the renderer runs. */
export function renderHook(window: Window): object {
  return {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
    checkDCE: () => {},
    onScheduleFiberRoot: () => {},
    onCommitFiberRoot: (_renderer: number, root: { readonly current: Fiber }) => countCommit(meterOf(window), root.current),
    onPostCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    setStrictMode: () => {},
  }
}

/**
 * Waits until the page and its engine are at rest: no commit, no frame either
 * way and nothing scheduled for `quietMillis` in a row, longer than the page's
 * own delays (the composer saves its draft 400 ms after the last key). Counts
 * taken after it hold all the work an action set off.
 */
export async function settledPage(window: Window, quietMillis = 600, timeoutMillis = 15_000): Promise<void> {
  const meter = meterOf(window)
  const signature = () => {
    const work = meter.read()
    return `${work.commits}:${work.requests}:${work.messages}:${work.bytesIn}:${work.bytesOut}:${meter.posts}`
  }
  const started = Date.now()
  let last = signature()
  let since = Date.now()
  while (Date.now() - since < quietMillis) {
    if (Date.now() - started > timeoutMillis) throw new Error('the page did not come to rest')
    await new Promise((resolve) => setTimeout(resolve, 25))
    const now = signature()
    if (now !== last || meter.posts > 0) {
      last = now
      since = Date.now()
    }
  }
}

/** A seeded `Math.random` for the page (mulberry32), on the window only: the realm's `Math` stays as it was. */
export function seedRandom(window: Window, seed = 1): void {
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  Object.defineProperty(window, 'Math', { value: Object.assign(Object.create(Math) as Math, { random }), writable: true, configurable: true })
}

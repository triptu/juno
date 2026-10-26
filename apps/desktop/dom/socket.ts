/**
 * The page's WebSocket in the DOM lane (`window.ts` installs it): a hold on
 * the engine's replies that lets a test make the engine slow, the port
 * traffic counted by RPC route (`work.ts`), and, with `serialFrames`, the
 * engine's frames handed to the page one at a time.
 */
import type { Window } from 'happy-dom'
import { meterOf } from './work'

/** Windows `closeWindow` has closed, and each window's open sockets. */
const closed = new WeakSet<Window>()
const sockets = new WeakMap<Window, Set<WebSocket>>()

/** Windows whose engine frames reach the page one at a time (`serialFrames`). */
const serial = new WeakSet<Window>()

/**
 * Hands `window`'s engine frames to the page one at a time, the next once the
 * page has nothing scheduled (`settled`), so frames never share a React
 * commit by chance of timing and counted renders are the same in every run.
 */
export function serialFrames(window: Window): void {
  serial.add(window)
}

/** The RPC protocol's own messages: the keep-alive, sent on a timer, and the acknowledgement of each stream value, which `messages` already counts. */
const KEEP_ALIVE = new Set(['Ping', 'Pong', 'Ack'])

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
/** Every number, run of digits and UUID counted at one width: a later timestamp, a larger id or a new message id is not more traffic. */
const fixedNumbers = (_key: string, value: unknown) => (typeof value === 'number' ? 0 : typeof value === 'string' ? value.replace(UUID, 'uuid').replace(/\d+/g, '0') : value)
const encoder = new TextEncoder()
const bytesOf = (message: unknown) => encoder.encode(JSON.stringify(message, fixedNumbers)).byteLength

/**
 * Waits until the page has nothing scheduled: no message on a channel
 * (React's scheduler) for three turns of Bun's own timers and immediates,
 * which the page's zero-delay timers come before.
 */
async function settled(window: Window): Promise<void> {
  const meter = meterOf(window)
  let quiet = 0
  while (quiet < 3 && !closed.has(window)) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setImmediate(resolve))
    quiet = meter.posts === 0 ? quiet + 1 : 0
  }
}

type Meter = ReturnType<typeof meterOf>
type Message = Record<string, unknown>

/** Counts the page's frame to the host by route; `asked` learns each request's route from its id. */
function countSent(meter: Meter, asked: Map<string, string>, data: unknown): void {
  if (typeof data !== 'string') return
  for (const message of rpcMessages(data)) {
    if (KEEP_ALIVE.has(String(message['_tag']))) continue
    // The engine's RPC (`_tag`), or the web shell's bridge to what main does (`channel`).
    const request = message['_tag'] === 'Request' || typeof message['channel'] === 'string'
    if (request) asked.set(String(message['id']), message['_tag'] === 'Request' ? String(message['tag']) : `bridge ${String(message['channel'])}`)
    const traffic = meter.route(asked.get(String(message['requestId'] ?? message['id'])) ?? String(message['_tag']))
    if (request) traffic.requests++
    traffic.bytesOut += bytesOf(message)
  }
}

/** Counts a frame from the host by route, and answers each message's route. */
function countReceived(meter: Meter, asked: ReadonlyMap<string, string>, messages: ReadonlyArray<Message>): ReadonlyArray<string | undefined> {
  const tags = messages.map((message) => asked.get(String(message['requestId'] ?? message['id'])))
  messages.forEach((message, at) => {
    if (KEEP_ALIVE.has(String(message['_tag']))) return
    const traffic = meter.route(tags[at] ?? String(message['_tag'] ?? 'bridge'))
    traffic.bytesIn += bytesOf(message)
    if (message['_tag'] === 'Chunk' && Array.isArray(message['values'])) traffic.messages += message['values'].length
    else if (message['_tag'] === 'Exit' || message['_tag'] === undefined) traffic.messages++
  })
  return tags
}

/** A socket's frames for the page, one at a time once the page has settled after the last (`serialFrames`). */
function frameQueue(window: Window, dispatch: (event: Event) => void): (event: Event) => void {
  const queue: Array<Event> = []
  let pumping = false
  const pump = async () => {
    if (pumping) return
    pumping = true
    try {
      while (queue.length > 0 && !closed.has(window)) {
        dispatch(queue.shift()!)
        await settled(window)
      }
    } finally {
      pumping = false
    }
  }
  return (event) => {
    if (!serial.has(window)) return dispatch(event)
    queue.push(event)
    void pump()
  }
}

/**
 * Bun's WebSocket, which happy-dom does not know about: each one is kept so
 * `closeWindow` closes it, and a closed page cannot open another. Left open,
 * a closed page keeps receiving, rendering and asking its host, and the
 * worker's pooled host serves the next test on the same port.
 */
export function pageSocket(window: Window): typeof WebSocket {
  const live = new Set<WebSocket>()
  sockets.set(window, live)
  const meter = meterOf(window)
  return class PageSocket extends WebSocket {
    readonly #asked = new Map<string, string>()
    readonly #listeners = new Map<unknown, (event: Event) => void>()
    readonly #deliver = frameQueue(window, (event) => {
      for (const listener of Array.from(this.#listeners.values())) listener(event)
    })

    constructor(url: string | URL, protocols?: string | string[]) {
      if (closed.has(window)) throw new Error(`This page has closed; it cannot connect to ${new URL(url).pathname}`)
      super(url, protocols)
      live.add(this)
      this.addEventListener('close', () => live.delete(this))
      super.addEventListener('message', (event) => {
        const data = (event as MessageEvent).data
        const tags = countReceived(meter, this.#asked, typeof data === 'string' ? rpcMessages(data) : [])
        const hold = held.get(window)
        if (hold !== undefined && tags.some((tag) => tag !== undefined && hold.tags.has(tag))) hold.frames.push(() => this.#deliver(event))
        else this.#deliver(event)
      })
    }

    override send(data: Parameters<WebSocket['send']>[0]): void {
      countSent(meter, this.#asked, data)
      super.send(data)
    }

    override addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
      if (type !== 'message') return super.addEventListener(type, listener, options)
      this.#listeners.set(listener, (event) => (typeof listener === 'function' ? listener.call(this, event) : listener.handleEvent(event)))
    }

    override removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
      if (type !== 'message') return super.removeEventListener(type, listener, options)
      this.#listeners.delete(listener)
    }
  }
}

/** Replies held back from a page's engine socket, by RPC tag, until `release`. */
const held = new WeakMap<Window, { readonly tags: Set<string>; readonly frames: Array<() => void> }>()

const rpcMessages = (data: string): ReadonlyArray<Message> => {
  const decoded = JSON.parse(data) as unknown
  return (Array.isArray(decoded) ? decoded : [decoded]).filter((message): message is Message => typeof message === 'object' && message !== null)
}

/**
 * Holds the engine's replies to the RPC `tags` (`drafts.get`) the page
 * asks for from now on, as a slow engine would, until the returned
 * function delivers them in order.
 */
export function holdReplies(window: Window, tags: ReadonlyArray<string>): () => void {
  const hold = { tags: new Set(tags), frames: [] as Array<() => void> }
  held.set(window, hold)
  return () => {
    if (held.get(window) === hold) held.delete(window)
    for (const frame of hold.frames.splice(0)) frame()
  }
}

/** Whether `closeWindow` has closed `window`. */
export const pageClosed = (window: Window): boolean => closed.has(window)

/** Closes `window`'s sockets; its page cannot open another. */
export function closeSockets(window: Window): void {
  closed.add(window)
  for (const socket of sockets.get(window) ?? []) socket.close()
}

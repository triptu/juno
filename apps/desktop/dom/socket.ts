/**
 * The page's WebSocket in the DOM lane (`window.ts` installs it), and a hold
 * on the engine's replies that lets a test make the engine slow.
 */
import type { Window } from 'happy-dom'

/** Windows `closeWindow` has closed, and each window's open sockets. */
const closed = new WeakSet<Window>()
const sockets = new WeakMap<Window, Set<WebSocket>>()

/**
 * Bun's WebSocket, which happy-dom does not know about: each one is kept so
 * `closeWindow` closes it, and a closed page cannot open another. Left open,
 * a closed page keeps receiving, rendering and asking its host, and the
 * worker's pooled host serves the next test on the same port.
 */
export function pageSocket(window: Window): typeof WebSocket {
  const live = new Set<WebSocket>()
  sockets.set(window, live)
  return class PageSocket extends WebSocket {
    readonly #asked = new Map<string, string>()
    constructor(url: string | URL, protocols?: string | string[]) {
      if (closed.has(window)) throw new Error(`This page has closed; it cannot connect to ${new URL(url).pathname}`)
      super(url, protocols)
      live.add(this)
      this.addEventListener('close', () => live.delete(this))
    }

    override send(data: Parameters<WebSocket['send']>[0]): void {
      if (typeof data === 'string') for (const message of rpcMessages(data)) if (message['_tag'] === 'Request') this.#asked.set(String(message['id']), String(message['tag']))
      super.send(data)
    }

    override addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
      if (type !== 'message') return super.addEventListener(type, listener, options)
      const deliver = (event: Event) => (typeof listener === 'function' ? listener.call(this, event) : listener.handleEvent(event))
      super.addEventListener(type, (event) => {
        const hold = held.get(window)
        const data = (event as MessageEvent).data
        const tags = typeof data === 'string' ? rpcMessages(data).map((message) => this.#asked.get(String(message['requestId']))) : []
        if (hold !== undefined && tags.some((tag) => tag !== undefined && hold.tags.has(tag))) hold.frames.push(() => deliver(event))
        else deliver(event)
      }, options)
    }
  }
}

/** Replies held back from a page's engine socket, by RPC tag, until `release`. */
const held = new WeakMap<Window, { readonly tags: Set<string>; readonly frames: Array<() => void> }>()

const rpcMessages = (data: string): ReadonlyArray<Record<string, unknown>> => {
  const decoded = JSON.parse(data) as unknown
  return (Array.isArray(decoded) ? decoded : [decoded]).filter((message): message is Record<string, unknown> => typeof message === 'object' && message !== null)
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

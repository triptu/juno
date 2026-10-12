/**
 * The only thing the engine needs from its host: a source of ports.
 *
 * Each renderer (or test client) gets one port. The Electron entry pushes the
 * `MessagePortMain`s it receives over `process.parentPort` into
 * `electronTransport`; tests push Node `MessageChannel` ports into
 * `memoryTransport`. The engine never imports `electron`, so the Electron
 * port is typed against the shape it uses, not Electron's classes.
 */

/** A port the engine talks on. All three port flavours fit after adapting. */
export interface EnginePort {
  readonly postMessage: (message: unknown) => void
  readonly onMessage: (f: (message: unknown) => void) => void
  readonly onClose: (f: () => void) => void
  readonly close: () => void
}

export interface Transport {
  /** Calls `attach` for every port, now and later. Returns an unsubscribe. */
  readonly ports: (attach: (port: EnginePort) => void) => () => void
}

/** Collects ports pushed in from the outside. Used by both transports below. */
function portSource(): Transport & { readonly add: (port: EnginePort) => void } {
  const listeners = new Set<(port: EnginePort) => void>()
  const pending: Array<EnginePort> = []
  return {
    ports: (attach) => {
      listeners.add(attach)
      for (const port of pending.splice(0)) attach(port)
      return () => {
        listeners.delete(attach)
      }
    },
    add: (port) => {
      if (listeners.size === 0) pending.push(port)
      else for (const attach of listeners) attach(port)
    },
  }
}

/** The shape of Electron's `MessagePortMain` that the engine uses. */
export interface MessagePortMainLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown
  on(event: 'close', listener: () => void): unknown
  postMessage(message: unknown): void
  start(): void
  close(): void
}

function fromMessagePortMain(port: MessagePortMainLike): EnginePort {
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage: (f) => {
      port.on('message', (event) => f(event.data))
    },
    onClose: (f) => {
      port.on('close', f)
    },
    close: () => port.close(),
  }
}

/** The shape of a DOM-style port: a Node `worker_threads` port in tests. */
export interface MessagePortLike {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'close', listener: () => void): void
  postMessage(message: unknown): void
  start?(): void
  close(): void
}

function fromMessagePort(port: MessagePortLike): EnginePort {
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage: (f) => {
      port.addEventListener('message', (event) => f(event.data))
    },
    onClose: (f) => {
      port.addEventListener('close', f)
    },
    close: () => port.close(),
  }
}

/**
 * The transport for Electron: the utility process entry adds every port main
 * sends in a `port` message (see `MainToEngine`). Ports are started here;
 * `MessagePortMain` queues messages until `start()` is called.
 */
export function electronTransport(): Transport & { readonly add: (port: MessagePortMainLike) => void } {
  const source = portSource()
  return {
    ports: source.ports,
    add: (port) => {
      source.add(fromMessagePortMain(port))
      port.start()
    },
  }
}

/** A transport for tests: push Node `MessageChannel` ports into it. */
export function memoryTransport(): Transport & { readonly add: (port: MessagePortLike) => void } {
  const source = portSource()
  return {
    ports: source.ports,
    add: (port) => {
      source.add(fromMessagePort(port))
      port.start?.()
    },
  }
}

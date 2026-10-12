/**
 * Entry of the engine utility process. Main forks this file (built to
 * out/main/engine.js) with `partition: 'persist:slack'`, sends the config over
 * parentPort, and hands over one MessagePort per renderer. This file owns
 * the one parentPort listener and the two Electron-backed seams the engine
 * needs; everything else is `@juno/engine`, which never imports Electron.
 *
 * - `Host`: every parentPort message that is not `config` or `port` goes to
 *   the engine's `HostLink`; messages that arrive before it subscribes are
 *   kept in order.
 * - `HttpTransport.ElectronNet`: `net.fetch` on this process's session (ADR
 *   0007), so Chromium attaches the `d` cookie, stores rotations and uses
 *   the system proxy and CAs.
 */
import { net } from 'electron'
import { Effect, Layer, Schema } from 'effect'
import { MainToEngine, type EngineToMain } from '@juno/contract'
import { electronTransport, startEngine, type Host } from '@juno/engine'
import { HttpTransport, HttpTransportError, type HttpResponse } from '@juno/slack'

const parent = process.parentPort
const decode = Schema.decodeUnknownSync(MainToEngine)
const transport = electronTransport()
// parentPort has no target origin; the unicorn rule is about window.postMessage.
// oxlint-disable-next-line unicorn/require-post-message-target-origin
const send = (message: EngineToMain) => parent.postMessage(message)

const hostListeners = new Set<(message: MainToEngine) => void>()
const pendingForHost: Array<MainToEngine> = []
const host: Host = {
  send,
  onMessage: (f) => {
    hostListeners.add(f)
    for (const message of pendingForHost.splice(0)) f(message)
    return () => {
      hostListeners.delete(f)
    }
  },
}

const ElectronNet: Layer.Layer<HttpTransport> = Layer.succeed(HttpTransport, {
  request: (request) =>
    Effect.tryPromise({
      try: async (signal) => {
        const response = await net.fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal,
          redirect: 'manual',
          credentials: 'include',
        })
        const text = await response.text()
        return {
          status: response.status,
          header: (name) => response.headers.get(name) ?? undefined,
          text,
        } satisfies HttpResponse
      },
      catch: (cause) => new HttpTransportError({ message: cause instanceof Error ? cause.message : String(cause) }),
    }),
})

let started = false
parent.on('message', (event) => {
  let message: MainToEngine
  try {
    message = decode(event.data)
  } catch (cause) {
    console.error('engine: bad message from main', cause)
    return
  }
  switch (message._tag) {
    case 'config': {
      if (started) return
      started = true
      startEngine(transport, message.config, { host, httpTransport: ElectronNet }).then(
        () => send({ _tag: 'ready' }),
        (cause: unknown) => {
          console.error('engine: failed to start', cause)
          process.exit(1)
        },
      )
      return
    }
    case 'port': {
      const port = event.ports[0]
      if (port) transport.add(port)
      return
    }
    default: {
      if (hostListeners.size === 0) pendingForHost.push(message)
      else for (const f of hostListeners) f(message)
      return
    }
  }
})

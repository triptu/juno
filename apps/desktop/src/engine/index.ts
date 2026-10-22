/**
 * Entry of the engine utility process. Main forks this file (built to
 * out/main/engine.js) with `partition: 'persist:slack'`, sends the config over
 * parentPort, and hands over one MessagePort per renderer. This file owns
 * the one parentPort listener and the two Electron-backed seams the engine
 * needs; everything else is `@juno/engine`, which never imports Electron.
 *
 * - `Host`: every parentPort message that is not `config`, a port or `quit`
 *   goes to the engine's `HostLink`; messages that arrive before it
 *   subscribes are kept in order. `quit` stops the engine, then the process.
 * - `agentTransport`: ports main brokers to the agent utility process, on
 *   which the engine serves the AgentHost group (ADR 0012).
 * - `HttpTransport.ElectronNet`: `net.fetch` on this process's session (ADR
 *   0007), so Chromium attaches the `d` cookie, stores rotations and uses
 *   the system proxy and CAs.
 */
// First, so coverage (test runs only) starts before the rest of the bundle runs.
import '../coverage'
import { installProcessLog } from '../processLog'
import { createTestWork } from './testWork'
import { net } from 'electron'
import { Effect, Layer, Record, Schema } from 'effect'
import { MainToEngine, type EngineToMain } from '@juno/contract'
import { electronTransport, productionTiming, startEngine, type EngineHandle, type Host } from '@juno/engine'
import { HttpTransport, HttpTransportError, type HttpResponse } from '@juno/slack'

const processLog = installProcessLog('engine')

const parent = process.parentPort
const decode = Schema.decodeUnknownSync(MainToEngine)
const transport = electronTransport()
const agentTransport = electronTransport()
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

let testWork: ReturnType<typeof createTestWork> | undefined
let engine: Promise<EngineHandle> | undefined
parent.on('message', (event) => {
  let message: MainToEngine
  try {
    message = decode(event.data)
  } catch {
    console.error('engine: bad message from main')
    return
  }
  switch (message._tag) {
    case 'config': {
      if (engine !== undefined) return
      testWork = message.config.e2e && message.config.fakeSlackUrl !== undefined ? createTestWork(send) : undefined
      const fastTiming = testWork !== undefined && process.env.JUNO_E2E_FAST_TIMING === '1'
      engine = startEngine(transport, message.config, {
        host, httpTransport: ElectronNet, agentTransport, agentWrites: 'enabled', logger: processLog.effectLogger,
        ...(fastTiming && testWork ? { work: testWork.control } : {}),
        ...(fastTiming
          ? { timing: {
              ...Record.map(productionTiming, (millis) => millis / 20),
              // As in the unit harness, explicit catch-ups replace periodic discovery.
              sweepIntervalMillis: 0,
              followPassMillis: 0,
              // Electron and the fake run in separate real processes, on a shared runner.
              socketHelloTimeoutMillis: productionTiming.socketHelloTimeoutMillis,
              socketPongTimeoutMillis: productionTiming.socketPongTimeoutMillis,
              // Stands for how far Slack's edge lags its socket, which the fake keeps in real time (`setHuddleInfoLag`).
              huddleInfoSettleMillis: productionTiming.huddleInfoSettleMillis,
            } }
          : {}),
      })
      engine.then(
        () => { processLog.log('INFO', 'process ready'); send({ _tag: 'ready' }) },
        (cause: unknown) => {
          console.error('engine: failed to start', cause)
          void processLog.close().finally(() => process.exit(1))
        },
      )
      return
    }
    case 'testWork': {
      testWork?.request(message)
      return
    }
    case 'port': {
      const port = event.ports[0]
      if (port) transport.add(port)
      return
    }
    case 'quit': {
      // Closing the engine's scope waits for uninterruptible requests, such as a preference write.
      void (engine ?? Promise.resolve(undefined))
        .then((handle) => handle?.stop())
        .catch((cause: unknown) => console.error('engine: failed to stop', cause))
        .finally(async () => { await processLog.close(); process.exit(0) })
      return
    }
    case 'agentPort': {
      const port = event.ports[0]
      if (port) agentTransport.add(port)
      return
    }
    default: {
      if (hostListeners.size === 0) pendingForHost.push(message)
      else for (const f of hostListeners) f(message)
      return
    }
  }
})

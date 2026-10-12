// The port protocol end to end over an in-memory MessageChannel: the real
// engine (startEngine + memoryTransport) and the real state helpers
// (liveQuery, command) with a Node port in place of the renderer's. Each test
// gets its own registry, so nothing leaks between them.
import { MessageChannel } from 'node:worker_threads'
import { Exit } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { afterEach, describe, expect, it } from 'vitest'
import {
  configureConnection,
  connectionStateAtom,
  engineStatusAtom,
  makeRegistry,
  pingCommand,
  runCommand,
  type PortLike,
  type Registry,
} from '@juno/state'
import { enginePing } from '@juno/contract'
import { startEngine } from '../src/index'
import { memoryTransport, type MessagePortLike } from '../src/protocol/transport'

const stops: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop()
})

const config = { userData: '/tmp/juno-test', e2e: true, dev: false }

async function engineWithPorts() {
  const transport = memoryTransport()
  const engine = await startEngine(transport, config)
  stops.push(engine.stop)
  const registry = makeRegistry()
  let current: MessageChannel | undefined
  configureConnection(registry, {
    acquire: async () => {
      current = new MessageChannel()
      // Node ports have the DOM port surface the state client uses; only the
      // EventTarget typings differ.
      transport.add(current.port2 as unknown as MessagePortLike)
      return current.port1 as unknown as PortLike
    },
  })
  return { engine, registry, closePort: () => current?.port1.close() }
}

function waitFor<A>(f: () => A | undefined, timeoutMs = 5000): Promise<Exclude<A, undefined>> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const value = f()
      if (value !== undefined) return resolve(value as Exclude<A, undefined>)
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'))
      setTimeout(tick, 5)
    }
    tick()
  })
}

const liveStatus = (registry: Registry) =>
  waitFor(() => {
    const result = registry.get(engineStatusAtom)
    return AsyncResult.isSuccess(result) ? result.value : undefined
  })

describe('port protocol', () => {
  it('serves a live query and a command over a MessageChannel', async () => {
    const { registry } = await engineWithPorts()
    const unmount = registry.mount(engineStatusAtom)
    try {
      const status = await liveStatus(registry)
      // No stored session: the engine is up and waiting for a sign-in.
      expect(status.phase._tag).toBe('first-run')
      expect(registry.get(connectionStateAtom)).toBe('connected')

      const unmountPing = registry.mount(pingCommand)
      registry.set(pingCommand, { n: 41 })
      const pong = await waitFor(() => {
        const result = registry.get(pingCommand)
        return AsyncResult.isSuccess(result) ? result.value : undefined
      })
      expect(pong.pong).toBe(42)
      unmountPing()
    } finally {
      unmount()
    }
  })

  it('runs a command without a mounted atom', async () => {
    const { registry } = await engineWithPorts()
    const [a, b] = await Promise.all([runCommand(registry, enginePing, { n: 1 }), runCommand(registry, enginePing, { n: 10 })])
    expect(Exit.isSuccess(a) && a.value.pong).toBe(2)
    expect(Exit.isSuccess(b) && b.value.pong).toBe(11)
  })

  it('fails only the request whose handler has a defect; the port stays usable', async () => {
    const { registry } = await engineWithPorts()
    const unmount = registry.mount(engineStatusAtom)
    try {
      await liveStatus(registry)
      const broken = await runCommand(registry, enginePing, { n: -1 })
      expect(Exit.isFailure(broken)).toBe(true)

      const after = await runCommand(registry, enginePing, { n: 1 })
      expect(Exit.isSuccess(after) && after.value.pong).toBe(2)
      expect(registry.get(connectionStateAtom)).toBe('connected')
      expect(AsyncResult.isSuccess(registry.get(engineStatusAtom))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('reconnects on a new port after the old one closes', async () => {
    const { registry, closePort } = await engineWithPorts()
    const unmount = registry.mount(engineStatusAtom)
    try {
      const first = await liveStatus(registry)
      closePort()
      await waitFor(() => (registry.get(connectionStateAtom) === 'reconnecting' ? true : undefined))
      await waitFor(() => (registry.get(connectionStateAtom) === 'connected' ? true : undefined), 10_000)
      // Same engine process, new subscription: the snapshot comes again and
      // a command still answers.
      const after = await liveStatus(registry)
      expect(after.startedAt).toBe(first.startedAt)
      const pong = await runCommand(registry, enginePing, { n: 1 })
      expect(Exit.isSuccess(pong) && pong.value.pong).toBe(2)
    } finally {
      unmount()
    }
  })

  it('closes its ports when the engine stops', async () => {
    const { registry, engine } = await engineWithPorts()
    const unmount = registry.mount(engineStatusAtom)
    try {
      await liveStatus(registry)
      await engine.stop()
      await waitFor(() => (registry.get(connectionStateAtom) === 'reconnecting' ? true : undefined))
    } finally {
      unmount()
    }
  })
})

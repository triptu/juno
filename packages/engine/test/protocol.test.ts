// The port protocol end to end over an in-memory MessageChannel: the real
// engine (startEngine + memoryTransport) and the real state helpers
// (liveQuery, command) with a Node port in place of the renderer's.
import { MessageChannel } from 'node:worker_threads'
import { Effect, Schema, Stream } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { afterEach, describe, expect, it } from 'vitest'
import { configureConnection, connectionStateAtom, engineStatusAtom, pingCommand, registry, type PortLike } from '@juno/state'
import { startEngine } from '../src/index'
import { liveList } from '../src/protocol/live'
import { memoryTransport, type MessagePortLike } from '../src/protocol/transport'

const stops: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop()
})

async function engineWithPorts() {
  const transport = memoryTransport()
  const engine = await startEngine(transport, { userData: '/tmp/juno-test', e2e: true })
  stops.push(engine.stop)
  let current: MessageChannel | undefined
  configureConnection({
    acquire: async () => {
      current = new MessageChannel()
      // Node ports have the DOM port surface the state client uses; only the
      // EventTarget typings differ.
      transport.add(current.port2 as unknown as MessagePortLike)
      return current.port1 as unknown as PortLike
    },
  })
  return { engine, closePort: () => current?.port1.close() }
}

function waitFor<A>(f: () => A | undefined, timeoutMs = 5000): Promise<Exclude<A, undefined>> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const value = f()
      if (value !== undefined) return resolve(value as Exclude<A, undefined>)
      if (Date.now() - started > timeoutMs) return reject(new Error("timed out"))
      setTimeout(tick, 5)
    }
    tick()
  })
}

describe('port protocol', () => {
  it('serves a live query and a command over a MessageChannel', async () => {
    await engineWithPorts()
    const unmount = registry.mount(engineStatusAtom)
    try {
      const status = await waitFor(() => {
        const result = registry.get(engineStatusAtom)
        return AsyncResult.isSuccess(result) ? result.value : undefined
      })
      expect(status.phase._tag).toBe('live')
      expect(status.uptime).toBeGreaterThanOrEqual(0)
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

  it('reconnects on a new port after the old one closes', async () => {
    const { closePort } = await engineWithPorts()
    const unmount = registry.mount(engineStatusAtom)
    try {
      const first = await waitFor(() => {
        const result = registry.get(engineStatusAtom)
        return AsyncResult.isSuccess(result) ? result.value : undefined
      })
      closePort()
      await waitFor(() => (registry.get(connectionStateAtom) === 'reconnecting' ? true : undefined))
      await waitFor(() => (registry.get(connectionStateAtom) === 'connected' ? true : undefined), 10_000)
      const after = await waitFor(() => {
        const result = registry.get(engineStatusAtom)
        return AsyncResult.isSuccess(result) && result.value.uptime > first.uptime ? result.value : undefined
      }, 10_000)
      // Same engine process, new subscription.
      expect(after.startedAt).toBe(first.startedAt)
    } finally {
      unmount()
    }
  })
})

describe('liveList', () => {
  const Row = Schema.Struct({ id: Schema.String, rev: Schema.Int, title: Schema.String })
  const encodeRow = Schema.encodeSync(Schema.toCodecJson(Row))

  it('sends the window first, then only rows whose rev changed', async () => {
    let rows = [
      { id: 'a', rev: 1, title: 'A' },
      { id: 'b', rev: 1, title: 'B' },
    ]
    const deltas = await Effect.runPromise(
      liveList({
        query: Effect.sync(() => ({ rows, total: rows.length })),
        invalidations: Stream.make(1, 2).pipe(
          Stream.tap(() =>
            Effect.sync(() => {
              rows = [
                { id: 'b', rev: 2, title: 'B2' },
                { id: 'c', rev: 1, title: 'C' },
              ]
            }),
          ),
        ),
        encodeRow,
      }).pipe(Stream.take(2), Stream.runCollect),
    )
    expect(deltas[0]).toMatchObject({ reset: true, order: ['a', 'b'], remove: [], meta: { seq: 1, total: 2 } })
    expect(deltas[0]!.upsert.map((r) => r.id)).toEqual(['a', 'b'])
    expect(deltas[1]).toMatchObject({ reset: false, order: ['b', 'c'], remove: ['a'], meta: { seq: 2 } })
    expect(deltas[1]!.upsert.map((r) => r.id)).toEqual(['b', 'c'])
  })
})

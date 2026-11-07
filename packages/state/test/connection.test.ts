/**
 * The connection state the sidebar shows while the engine is down, driven
 * through the real client protocol over a port the test hands out or refuses.
 */
import { describe, expect, it } from 'bun:test'
import { configureConnection, connectionStateAtom, makeRegistry, restartEngine } from '../src/client'
import { engineStatusAtom } from '../src/engine'
import { EngineFailed } from '../src/port'
import type { PortLike } from '../src/transport'

const waitFor = <A>(f: () => A | undefined, label: string, timeoutMs = 4_000): Promise<A> =>
  new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const value = f()
      if (value !== undefined) return resolve(value)
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${label}`))
      setTimeout(tick, 5)
    }
    tick()
  })

describe('the engine connection after its supervisor gave up', () => {
  it('a port request already out when Restart is pressed does not show the engine failed again', async () => {
    const registry = makeRegistry()
    // Each port request from the client, with the answer the test gives it; main's `failed` answer is an `EngineFailed`.
    const requests: Array<(cause: Error) => void> = []
    configureConnection(registry, {
      acquire: () => new Promise<PortLike>((_, reject) => requests.push(reject)),
    })
    const unmount = registry.mount(engineStatusAtom)
    try {
      const first = await waitFor(() => requests[0], 'the first port request')
      first(new EngineFailed())
      await waitFor(() => (registry.get(connectionStateAtom) === 'failed' ? true : undefined), 'the failed state')

      // The client asks again every second; the next request is on its way to main when Restart is pressed.
      const second = await waitFor(() => requests[1], 'the second port request')
      await restartEngine(registry, async () => {})
      expect(registry.get(connectionStateAtom)).toBe('reconnecting')
      // Main answers that request as it was queued: for the engine that had failed.
      second(new EngineFailed())

      // By the time the client asks a third time, that answer has been handled.
      await waitFor(() => requests[2], 'the third port request')
      expect(registry.get(connectionStateAtom)).toBe('reconnecting')
    } finally {
      unmount()
      registry.dispose()
    }
  })
})

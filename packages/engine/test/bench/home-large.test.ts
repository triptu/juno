// Home's local query budget on the large seed. JUNO_BENCH=1 only.
import { loadavg } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { largeSeed } from '@juno/fake-slack'
import { Effect } from 'effect'
import { Store, workspacePathsFromDir } from '@juno/store'
import { readHome } from '../../src/home/query'
import { startTestEngine } from '../harness'

describe.skipIf(process.env['JUNO_BENCH'] !== '1')('home.view on the large seed', () => {
  it('measures the local Home query', async () => {
    const engine = await startTestEngine({ initial: (fake) => fake.signIn(), fakeOptions: { seed: largeSeed() } })
    try {
      await engine.status('ready')
      await engine.phase('live', 600_000)
      await engine.syncIdle()
      await engine.handle.stop()

      const paths = workspacePathsFromDir(join(engine.userData, 'workspaces', engine.fake.teamId))
      const samples = await Effect.runPromise(
        Effect.gen(function* () {
          const times: Array<number> = []
          for (let index = 0; index < 41; index++) {
            const started = performance.now()
            yield* readHome()
            if (index > 0) times.push(performance.now() - started)
          }
          return times.toSorted((a, b) => a - b)
        }).pipe(Effect.provide(Store.layer(paths)), Effect.scoped),
      )
      console.log(`home.view large seed: ${JSON.stringify({ samples: samples.length, medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * 0.95)], load: loadavg()[0] })}`)
      expect(samples).toHaveLength(40)
    } finally {
      await engine.stop()
    }
  }, 600_000)
})

import { loadavg } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { largeSeed, SELF_ID } from '@juno/fake-slack'
import { Effect } from 'effect'
import { Store, StoreReader, workspacePathsFromDir } from '@juno/store'
import { frequentSendsStatement, queryFrequent } from '../../src/newchat/query'
import { startTestEngine } from '../harness'

describe.skipIf(process.env['JUNO_BENCH'] !== '1')('New chat frequent on the large seed', () => {
  it('ranks cached sends within the query budget without calling Slack', async () => {
    const engine = await startTestEngine({ initial: fake => fake.signIn(), fakeOptions: { seed: largeSeed() } })
    try {
      await engine.status('ready')
      await engine.phase('live', 600_000)
      await engine.syncIdle()
      const calls = engine.fake.callCount()
      const paths = workspacePathsFromDir(join(engine.userData, 'workspaces', engine.fake.teamId))
      const result = await Effect.runPromise(Effect.gen(function* () {
        const sql = yield* StoreReader
        const statement = frequentSendsStatement(SELF_ID, Date.now())
        const sends = yield* sql.unsafe(statement.sql, statement.params)
        const messages = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM messages`
        const rows = yield* queryFrequent()
        const samples: number[] = []
        for (let i = 0; i < 40; i++) {
          const start = performance.now()
          yield* queryFrequent()
          samples.push(performance.now() - start)
        }
        return { samples: samples.toSorted((a, b) => a - b), sends: sends.length, messages: messages[0]?.count, rows: rows.length }
      }).pipe(Effect.provide(Store.layer(paths)), Effect.scoped))
      console.log(`newChat.frequent: ${JSON.stringify({ ...result, load: loadavg()[0] })}`)
      expect(result.sends).toBeGreaterThan(0)
      expect(result.rows).toBe(10) // Five people and five channels, as in Home.
      expect(engine.fake.callCount()).toBe(calls)
      expect(result.samples[37]).toBeLessThanOrEqual(5)
    } finally {
      await engine.stop()
    }
  }, 600_000)
})

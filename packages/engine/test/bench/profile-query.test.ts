// Where the sidebar query spends its time on the large seed. JUNO_BENCH=1 only.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { largeSeed } from '@juno/fake-slack'
import { Store, StoreReader, workspacePathsFromDir } from '@juno/store'
import { listStatements, listTopics } from '../../src/topics/query'
import { startTestEngine } from '../harness'

describe.skipIf(process.env['JUNO_BENCH'] !== '1')('profile topics.list', () => {
  it('times the parts', async () => {
    const engine = await startTestEngine({ initial: (fake) => fake.signIn(), fakeOptions: { seed: largeSeed() } })
    try {
      await engine.status('ready')
      await engine.phase('live', 600_000)
      await engine.topics()
      const paths = workspacePathsFromDir(join(engine.userData, 'workspaces', engine.fake.teamId))
      const now = Date.now()
      const cutoff = `${Math.floor((now - 7 * 24 * 3600 * 1000) / 1000)}.000000`
      const program = Effect.gen(function* () {
        const sql = yield* StoreReader
        const time = <A>(label: string, effect: Effect.Effect<A, unknown, StoreReader>, runs = 20) =>
          Effect.gen(function* () {
            yield* effect
            const start = performance.now()
            let last: A | undefined
            for (let i = 0; i < runs; i++) last = yield* effect
            console.log(`${label}: ${((performance.now() - start) / runs).toFixed(2)} ms`)
            return last as A
          })
        const statements = listStatements({ kind: 'all', unreadOnly: false }, cutoff, 300)
        for (const [index, statement] of statements.entries()) {
          yield* time(`statement ${index}`, sql.unsafe(statement.sql, statement.params))
        }
        const rows = yield* sql.unsafe<{ participants_json: string | null }>(statements[0]!.sql, statements[0]!.params)
        const ids = new Set<string>()
        for (const row of rows) for (const id of JSON.parse(row.participants_json ?? '[]') as Array<string>) ids.add(id)
        console.log(`user ids: ${ids.size}`)
        yield* time('users IN', sql`SELECT id, name, display_name, real_name, avatar_url FROM users WHERE id IN ${sql.in([...ids])}`)
        yield* time('listTopics', listTopics({ kind: 'all', unreadOnly: false }, { now, limit: 300 }))
        yield* time('count only', sql`SELECT count(*) AS n FROM topic_index`)
      })
      await Effect.runPromise(program.pipe(Effect.provide(Store.layer(paths)), Effect.scoped))
      expect(true).toBe(true)
    } finally {
      await engine.stop()
    }
  }, 900_000)
})

import { loadavg } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'bun:test'
import { Effect } from 'effect'
import { Store, workspacePathsFromDir } from '@juno/store'
import { queryConversations, queryPaletteConversations } from '../../src/newchat/query'
import { largeSeedEngine } from './largeSeedEngine'
import { perfBudget } from '@juno/testing/perf-budget'

/** Each keystroke of a name, as ⌘K's Conversations tab and the New chat picker ask for it. */
const KEYSTROKES = ['d', 'de', 'dev', 'dev ', 'dev o', 'dev op', 'a', 'al', 'ali', 'alic', 'alice', 'alice w']

describe('conversation search on the large seed', () => {
  it('answers each keystroke within the palette budget once the words are indexed', async () => {
    const { engine } = await largeSeedEngine()
    await engine.syncIdle()
    const paths = workspacePathsFromDir(join(engine.userData, 'workspaces', engine.fake.teamId))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const first = performance.now()
        yield* queryPaletteConversations('x')
        const build = performance.now() - first
        const palette: number[] = []
        const picker: number[] = []
        for (let round = 0; round < 4; round++) {
          for (const text of KEYSTROKES) {
            const start = performance.now()
            yield* queryPaletteConversations(text)
            palette.push(performance.now() - start)
            const next = performance.now()
            yield* queryConversations(text)
            picker.push(performance.now() - next)
          }
        }
        const p95 = (samples: number[]) => samples.toSorted((a, b) => a - b)[Math.floor(samples.length * 0.95)]!
        return { build, palette: p95(palette), picker: p95(picker) }
      }).pipe(Effect.provide(Store.layer(paths)), Effect.scoped),
    )
    console.log(`conversation search: ${JSON.stringify({ ...result, load: loadavg()[0] })}`)
    // The palette's whole keystroke budget is 100 ms p95 (performance 1); the query is a small part of it.
    perfBudget('conversation search: palette query p95', result.palette, 25)
    perfBudget('conversation search: picker query p95', result.picker, 25)
  }, 600_000)
})

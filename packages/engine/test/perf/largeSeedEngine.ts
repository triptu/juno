import { largeSeed } from '@juno/fake-slack'
import { startTestEngine, type RunningEngine } from '../harness'

export interface LargeSeedBoot {
  readonly engine: RunningEngine
  /** Making the seed and starting the engine, ms. */
  readonly seededMs: number
  /** From `ready` to `live`: the first sync of 300 channels and 100 000 messages, ms. */
  readonly bootMs: number
  /** Slack calls the boot made. */
  readonly calls: number
}

let boot: Promise<LargeSeedBoot> | undefined

/**
 * One cold boot of the large seed, shared by the sidebar, All topics and
 * conversation search budgets, which run in one `bun test` process
 * (`scripts/perf.mjs` runs them together, in bun's shuffled order): each
 * boot took about 17 s on the laptop. Each budget reads what it needs and
 * leaves the engine running; the process ends with it.
 */
export function largeSeedEngine(): Promise<LargeSeedBoot> {
  boot ??= (async () => {
    const started = Date.now()
    const engine = await startTestEngine({ initial: (fake) => fake.signIn(), fakeOptions: { seed: largeSeed() } })
    const seededMs = Date.now() - started
    await engine.status('ready')
    const bootStarted = Date.now()
    await engine.phase('live', 600_000)
    return { engine, seededMs, bootMs: Date.now() - bootStarted, calls: engine.fake.callCount() }
  })()
  return boot
}

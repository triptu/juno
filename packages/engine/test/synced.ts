/**
 * A workspace the default seed has already synced, for tests whose first sync
 * is only setup. Once per test process, in a `beforeAll` of the first test file
 * that imports this module, it cold-boots one engine on a fake made at a fixed
 * seed time, waits until it is quiet, stops it and keeps a copy of its
 * user-data folder, so no test's own time includes that first sync. Each `syncedEngine` then starts a fresh fake on
 * the same seed time and port (so stored ids, timestamps and avatar URLs match)
 * and a fresh engine on its own copy of that folder: a warm start, the same as
 * a relaunch of the app. When another process holds the port by then, the fake
 * takes a free one and only the stored avatar URLs point at the old port.
 *
 * The copy lives in the temp folder under this process's id and is removed when
 * the process exits, so files that share a process (`bun test` without
 * `--parallel`, or several files on one `--parallel` worker) share it, and
 * nothing outlives the run. Tests of the first sync itself use `bootedEngine`.
 */
import { beforeAll } from 'bun:test'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeSlack, type Credentials } from '@juno/fake-slack'
import { limitScale } from '@juno/testing/limits'
import { startTestEngine, type EngineOptions, type RunningEngine } from './harness'
import { quiet } from './scenario'

interface Synced {
  readonly dir: string
  readonly seedTime: number
  readonly port: number
  readonly sessions: ReadonlyArray<Credentials>
}

const marker = join(tmpdir(), `juno-engine-synced-${process.pid}.json`)
let synced: Promise<Synced> | undefined

async function makeSynced(): Promise<Synced> {
  if (existsSync(marker)) {
    const shared = JSON.parse(readFileSync(marker, 'utf8')) as Synced
    if (existsSync(shared.dir)) return shared
  }
  const seedTime = Date.now()
  const engine = await startTestEngine({ fakeOptions: { seedTime }, initial: (fake) => fake.signIn() })
  const dir = await mkdtemp(join(tmpdir(), 'juno-engine-synced-'))
  let stopped = false
  try {
    await engine.status('ready')
    await engine.phase('live')
    await quiet(engine)
    const template: Synced = { dir, seedTime, port: Number(new URL(engine.fake.url).port), sessions: engine.fake.sessions() }
    // Stopping the engine closes the store, which checkpoints the WAL into the files copied here.
    engine.registry.dispose()
    await engine.handle.stop()
    stopped = true
    await cp(engine.userData, dir, { recursive: true })
    writeFileSync(marker, JSON.stringify(template))
    process.once('exit', () => {
      rmSync(dir, { recursive: true, force: true })
      rmSync(marker, { force: true })
    })
    return template
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  } finally {
    if (stopped) {
      await engine.fake.close()
      await rm(engine.userData, { recursive: true, force: true })
    } else await engine.stop()
  }
}

const template = () => (synced ??= makeSynced())

// Slow: a cold first sync of the default seed, once per test process, outside every test's own time. Later files in
// the same process find it made; a file run with `--isolate` finds it through the marker.
beforeAll(() => template().then(() => undefined), 60_000 * limitScale())

export type SyncedOptions = Omit<EngineOptions, 'initial' | 'fakeOptions' | 'enterpriseId' | 'reuse'>

/** An engine live on a copy of the synced default workspace. `track` collects engines for `afterEach` to stop. */
export async function syncedEngine(track: Array<RunningEngine>, options: SyncedOptions = {}): Promise<RunningEngine> {
  const made = await template()
  const start = (port: number) => startFakeSlack({ port, seedTime: made.seedTime, sessions: made.sessions })
  const fake = await start(made.port).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    return start(0)
  })
  const userData = await mkdtemp(join(tmpdir(), 'juno-engine-test-'))
  await cp(made.dir, userData, { recursive: true })
  const engine = await startTestEngine({ ...options, reuse: { userData, fake, credentials: { ...made.sessions[0]!, url: fake.url } } })
  const owned: RunningEngine = {
    ...engine,
    stop: async () => {
      await engine.stop()
      await fake.close()
      await rm(userData, { recursive: true, force: true })
    },
  }
  track.push(owned)
  await owned.status('ready')
  await owned.phase('live')
  await owned.syncIdle()
  return owned
}

import { createHash } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeSlack, type Credentials, type FakeSlack } from '@juno/fake-slack'

/**
 * A data folder signed in to the default seed and synced, for the browser
 * and DOM lanes' synced starts (e2e README, "Synced start"). It is built
 * once per run for each key, by whichever worker needs it first while the
 * others wait on a lock, and every worker copies it. A fake made to match
 * it needs its seed time and sessions, not its port: the host maps the
 * snapshot's fake origin to the test's own fake (`aliases` in
 * `web/host/fakeMain.ts`). Nothing here loads Playwright, so `bun test`
 * workers use it too.
 */
export interface WebSnapshot {
  readonly dir: string
  /** The origin of the fake it was made against, which its stored addresses name. */
  readonly origin: string
  readonly seedTime: number
  readonly sessions: ReadonlyArray<Credentials>
  /** `snapshotState` of that fake once the app had synced. */
  readonly fakeState: string
  readonly builtAt: number
}

export type SnapshotMade = Omit<WebSnapshot, 'dir' | 'builtAt'>

/**
 * A seed's messages are minutes before the time it ran, so an older snapshot
 * reads older to the app. Five minutes bounds that, as for Electron's.
 */
const MAX_AGE_MILLIS = 5 * 60_000
const root = join(process.env.JUNO_TEST_SCRATCH ?? tmpdir(), 'juno-browser-snapshots')

/** A hash of the fake's workspace with its own origin taken out, so a fake on another port can match it. */
export function snapshotState(fake: FakeSlack): string {
  const origin = new URL(fake.url).origin
  const json = JSON.stringify(fake.workspace, (key, value: unknown) => {
    if (key === 'clock' || key === 'manualPresence') return undefined
    if (value instanceof Map) return [...value]
    if (value instanceof Set) return [...value]
    return value
  })
  return createHash('sha256').update(json.replaceAll(origin, 'FAKE')).digest('hex')
}

/** A key for a build (its `.inputs-hash`) and the engine options the snapshot was made with. */
export async function snapshotKey(build: string, options: object): Promise<string> {
  const hash = await readFile(join(build, '.inputs-hash'), 'utf8')
  return createHash('sha256').update(hash).update(JSON.stringify(options)).digest('hex').slice(0, 24)
}

/** Removes snapshots from earlier runs. */
async function sweep(): Promise<void> {
  for (const name of await readdir(root).catch(() => [])) {
    const path = join(root, name)
    const info = await stat(path).catch(() => undefined)
    if (info !== undefined && Date.now() - info.mtimeMs > 60 * 60_000) await rm(path, { recursive: true, force: true })
  }
}

async function readMeta(file: string): Promise<WebSnapshot | undefined> {
  try {
    const meta = JSON.parse(await readFile(file, 'utf8')) as WebSnapshot
    return Date.now() - meta.builtAt < MAX_AGE_MILLIS && existsSync(meta.dir) ? meta : undefined
  } catch {
    return undefined
  }
}

/**
 * The snapshot for `key`: one made by any worker in the last five minutes,
 * or a new one from `make`, which signs in on the folder it is given. A
 * directory lock lets one worker build while the others wait for it.
 */
export async function sharedSnapshot(key: string, make: (dir: string) => Promise<SnapshotMade>): Promise<WebSnapshot> {
  await mkdir(root, { recursive: true })
  const meta = join(root, `${key}.json`)
  const lock = join(root, `${key}.lock`)
  const deadline = Date.now() + 120_000
  for (;;) {
    const ready = await readMeta(meta)
    if (ready !== undefined) return ready
    try {
      await mkdir(lock)
    } catch {
      const held = await stat(lock).catch(() => undefined)
      // A worker that died while building leaves its lock; one older than the build can take is stale.
      if (held !== undefined && Date.now() - held.mtimeMs > 90_000) await rmdir(lock).catch(() => undefined)
      if (Date.now() > deadline) throw new Error('Waited two minutes for another worker to build the synced snapshot')
      await new Promise((done) => setTimeout(done, 200))
      continue
    }
    try {
      const again = await readMeta(meta)
      if (again !== undefined) return again
      await sweep()
      const dir = await mkdtemp(join(root, `${key}-`))
      const builtAt = Date.now()
      const made: WebSnapshot = { dir, builtAt, ...(await make(dir)) }
      const partial = `${meta}.${process.pid}`
      await writeFile(partial, JSON.stringify(made))
      await rename(partial, meta)
      return made
    } finally {
      await rmdir(lock).catch(() => undefined)
    }
  }
}

/** Copies a snapshot into a test's data folder; on APFS a clone, so it costs almost nothing. */
export function copySnapshot(snapshot: WebSnapshot, userData: string): Promise<void> {
  return cp(snapshot.dir, userData, { recursive: true, mode: constants.COPYFILE_FICLONE })
}

/** A fake that makes the snapshot's seed again, on a port of its own, accepting its sessions. */
export function matchingFake(snapshot: WebSnapshot): Promise<FakeSlack> {
  return startFakeSlack({ seedTime: snapshot.seedTime, sessions: snapshot.sessions })
}

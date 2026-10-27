import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Credentials, FakeSlack } from '@juno/fake-slack'
import type { SyncedSeed } from './seeds'

/**
 * A user-data directory signed in to a seed (`seeds.ts`, the default unless named) and synced, with what a
 * fake needs to match it: the seed's time, the port its URLs name, and the
 * sessions the app holds. README, "Synced start".
 */
export interface SyncedWorkspace {
  readonly dir: string
  readonly port: number
  readonly seedTime: number
  readonly sessions: ReadonlyArray<Credentials>
  /** `fakeState` of the fake once the app had synced. */
  readonly fakeState: string
  /** The seed it was made on; absent for the default. */
  readonly seed?: SyncedSeed
}

/** The build marker covers the bundled source (schema, migrations, engine and sync), toolchain and output bytes; the seed loads once per run in this process. */
export async function syncedKey(options: object): Promise<string> {
  const build = await readFile(join(__dirname, '../out/.inputs-hash'), 'utf8')
  return createHash('sha256').update(build).update(JSON.stringify(options)).digest('hex')
}

/**
 * A seed's messages are minutes before the time it ran, so a copy made from an
 * older build reads older to the app. Five minutes bounds that, at one cold
 * sign-in per worker per five minutes.
 */
const MAX_AGE_MILLIS = 5 * 60_000

/** Builds each kind of synced workspace once per worker, and again when it is older than `MAX_AGE_MILLIS`. */
export class SyncedWorkspaces {
  readonly #built = new Map<string, { readonly at: number; readonly workspace: SyncedWorkspace }>()
  #root: string | undefined

  async get(key: string, build: (dir: string) => Promise<Omit<SyncedWorkspace, 'dir'>>): Promise<SyncedWorkspace> {
    const built = this.#built.get(key)
    if (built !== undefined && Date.now() - built.at < MAX_AGE_MILLIS) return built.workspace
    if (built !== undefined) await rm(built.workspace.dir, { recursive: true, force: true })
    this.#built.delete(key)
    this.#root ??= await mkdtemp(join(tmpdir(), 'juno-synced-'))
    const dir = await mkdtemp(join(this.#root, 'user-data-'))
    const at = Date.now()
    const workspace = { dir, ...(await build(dir)) }
    // Chromium's single-instance lock names the process that built it.
    for (const name of await readdir(dir)) if (name.startsWith('Singleton')) await rm(join(dir, name), { force: true })
    this.#built.set(key, { at, workspace })
    return workspace
  }

  /** Builds this kind again on the next `get`, as when its port is taken. */
  forget(key: string): void {
    this.#built.delete(key)
  }

  async close(): Promise<void> {
    if (this.#root !== undefined) await rm(this.#root, { recursive: true, force: true })
  }
}

/** Copies a synced workspace into a test's own user-data directory. */
export function copySynced(workspace: SyncedWorkspace, userData: string): Promise<void> {
  return cp(workspace.dir, userData, { recursive: true })
}

/**
 * A hash of the fake's workspace, to check that a fake made again matches the
 * one the app synced from. Self presence is left out: the engine sets it from
 * the clock at every session start.
 */
export function fakeState(fake: FakeSlack): string {
  const json = JSON.stringify(fake.workspace, (key, value: unknown) => {
    if (key === 'clock' || key === 'manualPresence') return undefined
    if (value instanceof Map) return [...value]
    if (value instanceof Set) return [...value]
    return value
  })
  return createHash('sha256').update(json).digest('hex')
}

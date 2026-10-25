/**
 * The browser lane's app without a browser: the same host process
 * (`e2e/browser/host.ts`: engine, agent, shell, sockets) and the same
 * renderer (`web/page/main.ts`, bundled by `vite.config.ts`), in a
 * happy-dom window (`window.ts`). One window and one engine per test; the
 * worker keeps one pool of loaded hosts for the whole run.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Window } from 'happy-dom'
import { startFakeSlack, type FakeSlack } from '@juno/fake-slack'
import { HostPool, type TestHost } from '../e2e/browser/host'
import { copySnapshot, matchingFake, sharedSnapshot, snapshotKey, snapshotState, type SnapshotMade, type WebSnapshot } from '../e2e/browser/snapshotCache'
import type { EngineOptions } from '../web/host/testHost'
import type { WebTestSeam } from '../web/page/testSeam'
import { PageClock } from './clock'
import { Dom } from './input'
import { DOM_BUILD, openWindow } from './window'

let pool: HostPool | undefined
/** One pool per Bun worker, kept across files; a host exits when the worker that forked it goes away. */
const hostPool = () => (pool ??= new HostPool(DOM_BUILD))

/** Ends the worker's hosts, so each writes its CPU profile (`profile.ts`). */
export async function closeHostPool(): Promise<void> {
  await pool?.close()
  pool = undefined
}

export async function tempUserData(): Promise<string> {
  return mkdtemp(join(process.env.JUNO_TEST_SCRATCH ?? tmpdir(), 'juno-dom-'))
}

/** Settles `work` within `millis`, or fails naming `what`. */
export async function within<T>(work: Promise<T>, millis: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${what} took more than ${millis} ms`)), millis) })])
  } finally { clearTimeout(timer) }
}

export interface StartOptions {
  readonly engine?: EngineOptions
  /** Origins a synced snapshot's addresses name. */
  readonly aliases?: ReadonlyArray<string>
  /** The page's test clock, installed before the renderer runs; the engine's follows it. */
  readonly clock?: PageClock
}

/** The engine options every DOM test gets unless it asks for others, as the browser lane's defaults. */
const DEFAULT_ENGINE: EngineOptions = { timing: 'fast', aiJobs: false }

export class DomApp {
  window: Window
  dom: Dom
  #closing: Promise<void> | undefined

  private constructor(
    readonly host: TestHost,
    readonly fake: FakeSlack,
    readonly userData: string,
    readonly clock: PageClock | undefined,
  ) {
    this.window = this.#open()
    this.dom = new Dom(this.window)
  }

  /** Starts a host on `userData` against `fake` and loads the renderer in a new window. */
  static async start(fake: FakeSlack, userData: string, options: StartOptions = {}): Promise<DomApp> {
    const engine = { ...DEFAULT_ENGINE, ...options.engine, ...(options.clock === undefined ? {} : { clock: true }) }
    const host = await hostPool().start(fake, { userData, aliases: options.aliases ?? [], engine })
    try {
      return new DomApp(host, fake, userData, options.clock)
    } catch (error) {
      await host.stop()
      throw error
    }
  }

  /** As the host's page route does: a verified session goes in the address, so the first frame is the shell. */
  #open(): Window {
    const sessionFile = join(this.userData, 'web-session.json')
    const ready = existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, 'utf8')) as { ready?: unknown }).ready : undefined
    const url = new URL(this.host.url)
    url.searchParams.set('e2e', '1')
    if (ready !== undefined) url.searchParams.set('session', JSON.stringify(ready))
    return openWindow(url.href, this.clock, this.clock === undefined ? undefined : { jump: (millis) => this.host.jumpClock(millis) })
  }

  /** The page's test seam (`web/page/testSeam.ts`): menus, links and app-menu commands. */
  get seam(): WebTestSeam {
    return (this.window as unknown as { __junoWebTest: WebTestSeam }).__junoWebTest
  }

  /**
   * Quits and opens the app again on the same data folder: the page goes, the
   * engine and agent stop, `whileClosed` runs, they start again and a new
   * window loads. localStorage goes with the window, as the browser lane's
   * launch preferences do not: a test of what main keeps stays in Electron.
   */
  async relaunch(options: { readonly whileClosed?: () => Promise<void> | void; readonly engine?: EngineOptions } = {}): Promise<void> {
    const local = this.window.localStorage
    const storage = Array.from({ length: local.length }, (_, at) => local.key(at)!).map((key) => [key, local.getItem(key)!] as const)
    await within(this.window.happyDOM.close(), 3_000, 'closing the page')
    await this.host.quitEngine()
    await options.whileClosed?.()
    await this.host.startEngine(options.engine)
    this.window = this.#open()
    for (const [key, value] of storage) this.window.localStorage.setItem(key, value)
    this.dom = new Dom(this.window)
  }

  /** The page first, so nothing in it waits on the host; each step is bounded so a stuck one names itself. */
  close(): Promise<void> {
    return this.#closing ??= (async () => {
      try {
        this.clock?.close()
        await within(this.window.happyDOM.close(), 3_000, 'closing the page')
      } finally {
        await within(this.host.stop(), 8_000, 'stopping the host')
      }
    })()
  }
}

/** Signs in through the page and waits for the first sync, for a snapshot. */
type SignIn = (app: DomApp) => Promise<void>

async function makeSnapshot(dir: string, signIn: SignIn): Promise<SnapshotMade> {
  const seedTime = Date.now()
  const fake = await startFakeSlack({ seedTime })
  try {
    const app = await within(DomApp.start(fake, dir), 15_000, 'snapshot: host start')
    try {
      await within(signIn(app), 30_000, 'snapshot: sign-in and first sync')
    } finally {
      await app.close()
    }
    return { origin: new URL(fake.url).origin, seedTime, sessions: fake.sessions(), fakeState: snapshotState(fake) }
  } finally {
    await fake.close()
  }
}

/** The DOM lane's synced snapshot, shared by every worker of the run (`sharedSnapshot`). */
export async function domSnapshot(signIn: SignIn): Promise<WebSnapshot> {
  return sharedSnapshot(`dom-${await snapshotKey(DOM_BUILD, DEFAULT_ENGINE)}`, (dir) => makeSnapshot(dir, signIn))
}

export interface Started {
  readonly app: DomApp
  readonly fake: FakeSlack
  readonly userData: string
  readonly close: () => Promise<void>
}

/**
 * A test's app: from a copy of the synced snapshot with a fake made to
 * match it (`synced`), or signed out on an empty folder. `warm` waits for the
 * warm boot and checks that the fake still matches what the snapshot saw.
 */
export async function startDomApp(options: StartOptions & { readonly snapshot?: WebSnapshot; readonly warm?: (app: DomApp) => Promise<void> }): Promise<Started> {
  const { snapshot } = options
  const fake = snapshot === undefined ? await startFakeSlack() : await matchingFake(snapshot)
  const userData = await tempUserData()
  let app: DomApp | undefined
  const close = async () => {
    try { await app?.close() } finally {
      await fake.close()
      await rm(userData, { recursive: true, force: true })
    }
  }
  try {
    if (snapshot !== undefined) {
      await copySnapshot(snapshot, userData)
      if (snapshotState(fake) !== snapshot.fakeState || fake.server.sockets.size !== 0) throw new Error('The new fake does not match the synced snapshot, or already has a socket.')
    }
    app = await within(DomApp.start(fake, userData, { ...options, aliases: snapshot === undefined ? [] : [snapshot.origin] }), 15_000, 'host start')
    if (snapshot !== undefined && options.warm !== undefined) {
      await within(options.warm(app), 20_000, 'warm boot')
      if (snapshotState(fake) !== snapshot.fakeState || fake.server.sockets.size !== 1) throw new Error('The fake no longer matches the synced snapshot this test started from. Something in the test setup or the warm boot changed the fake; sign in instead (synced: false), or remove the difference.')
    }
    return { app, fake, userData, close }
  } catch (error) {
    await close()
    throw error
  }
}

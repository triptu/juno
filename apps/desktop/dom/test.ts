/**
 * `domTest`: a DOM lane test (README). It starts the app signed in and
 * synced from the run's snapshot (or signed out with `synced: false`),
 * hands the body the driver, the fake Slack and the people in it, and
 * closes everything after, pass or fail. With JUNO_E2E_TIMINGS=1 each test
 * prints a `dom timing:` line: wall time, and the CPU of this Bun worker
 * (test, fake, renderer) and of the hosts it forked (engine, agent), and
 * the memory of both: the worker's peak and now, the hosts' now.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'bun:test'
import type { FakeSlack, FakeSlackOptions } from '@juno/fake-slack'
import { Slack } from '../e2e/driver/slack'
import type { EngineOptions } from '../web/host/testHost'
import { DomApp, domSnapshot, startDomApp, tempUserData, warmWorker } from './app'
import { PageClock } from './clock'
import { Juno } from './driver/juno'

/** A model a test serves the agent from: the fake OpenRouter or a scripted one. */
interface Model {
  readonly origin: string
  readonly close: () => Promise<void>
}

export interface DomTestOptions<M extends Model | undefined = undefined> {
  /** Start signed in and synced from the snapshot (default), or signed out on an empty folder. */
  readonly synced?: boolean
  /** The fake's own options, as a seed of its own; only with `synced: false`, since the snapshot is of the default seed. */
  readonly fake?: FakeSlackOptions
  readonly engine?: EngineOptions
  /** Install the test clock before the page loads, at this time or now; the engine's clock follows its jumps. */
  readonly clock?: boolean | number | Date
  /** Starts the model the agent talks to; the agent runs with it unless `engine.agent` is false, and the engine's AI uses it. */
  readonly model?: () => Promise<M & Model>
  /** The engine's frames reach the page one at a time, so counted renders do not depend on timing (`work.ts`). */
  readonly counted?: boolean
  readonly timeout?: number
  /** Tags, as a Playwright test has them: a test with a tag JUNO_SKIP_TAGS names is skipped (`@heavy-huddle`, scripts/test-areas.mjs). */
  readonly tag?: ReadonlyArray<string>
}

export interface DomContext<M extends Model | undefined = undefined> {
  juno: Juno
  readonly fake: FakeSlack
  readonly slack: Slack
  readonly app: DomApp
  readonly userData: string
  /** The page's test clock, with `clock` set. */
  readonly clock: PageClock
  readonly model: M
  /** Quits and opens the app again on the same data folder; answers the new driver (`DomApp.relaunch`). */
  relaunch(options?: Parameters<DomApp['relaunch']>[0]): Promise<Juno>
  /** A second app, as another Mac: its own data folder and host, signed out, against the same fake and model, with `engine` on top. Closed after the test. */
  otherApp(engine?: EngineOptions): Promise<Juno>
  /** A named part of the test; a failure inside says which. */
  step<T>(name: string, body: () => Promise<T>): Promise<T>
}

const signIn = async (app: DomApp) => {
  const juno = new Juno(app)
  await juno.signIn()
  await juno.waitForSync()
}

const skipTags = (process.env.JUNO_SKIP_TAGS ?? '').split(',').filter(Boolean)

export function domTest<M extends Model | undefined = undefined>(title: string, body: (context: DomContext<M>) => Promise<void>, options: DomTestOptions<M> = {}): void {
  const define = options.tag?.some((tag) => skipTags.includes(tag)) ? test.skip : test
  define(title, () => run(title, body, options), options.timeout ?? 60_000)
}

async function run<M extends Model | undefined>(title: string, body: (context: DomContext<M>) => Promise<void>, options: DomTestOptions<M>): Promise<void> {
  const meter = cpuMeter()
  // Every window shares the worker's `performance`: a mark from an earlier test is not this one's (`juno.lastMark`).
  performance.clearMarks()
  performance.clearMeasures()
  const model = options.model === undefined ? undefined : await options.model()
  try {
    const clock = options.clock === undefined || options.clock === false ? undefined : new PageClock(options.clock === true ? undefined : new Date(options.clock).getTime())
    const engine: EngineOptions = { ...(model === undefined ? {} : { agent: true, fakeOpenRouterUrl: model.origin }), ...options.engine }
    if (options.fake !== undefined && options.synced !== false) throw new Error('A fake of its own needs `synced: false`: the snapshot is of the default seed.')
    warmWorker()
    const snapshot = options.synced === false ? undefined : await domSnapshot(signIn)
    const ready = meter.lap()
    const started = await startDomApp({ snapshot, engine, counted: options.counted === true, ...(options.fake === undefined ? {} : { fake: options.fake }), ...(clock === undefined ? {} : { clock }), warm: (app) => new Juno(app).waitForSync() })
    const warm = meter.lap()
    const others: Array<{ app: DomApp | undefined; readonly userData: string }> = []
    try {
      const context: DomContext<M> = {
        juno: new Juno(started.app),
        fake: started.fake,
        slack: new Slack(started.fake),
        app: started.app,
        userData: started.userData,
        get clock(): PageClock {
          if (clock === undefined) throw new Error('This test has no clock; give domTest `clock: true`.')
          return clock
        },
        model: model as M,
        otherApp: async (extra) => {
          const userData = await tempUserData()
          const other = { app: undefined as DomApp | undefined, userData }
          others.push(other)
          other.app = await DomApp.start(started.fake, userData, { engine: { ...engine, ...extra } })
          return new Juno(other.app)
        },
        relaunch: async (relaunch) => {
          await started.app.relaunch(relaunch)
          context.juno = new Juno(started.app)
          return context.juno
        },
        step: async (name, inner) => {
          try {
            return await inner()
          } catch (error) {
            if (error instanceof Error) error.message = `step "${name}": ${error.message}`
            throw error
          }
        },
      }
      try {
        await body(context)
      } catch (error) {
        savePage(title, started.app, started.userData)
        throw error
      }
    } finally {
      for (const other of others) {
        try { await other.app?.close() } finally { await rm(other.userData, { recursive: true, force: true }) }
      }
      await started.close()
      if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`dom timing: ${JSON.stringify({ title, snapshot: ready, start: warm, ...meter.lap(), total: meter.total(), memory: memoryMB() })}`)
    }
  } finally {
    await model?.close()
  }
}

/** A failed test's page as it was, its sidebar trace and its logs, in `test-results/dom/` (a remote run brings them back). */
function savePage(title: string, app: DomApp, userData: string): void {
  try {
    const dir = join(__dirname, '../test-results/dom')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${title.replace(/[^\w]+/g, '-').slice(0, 80)}.html`)
    writeFileSync(file, app.window.document.documentElement.outerHTML)
    // The sidebar's hold and list values (e2e README, "Sidebar trace"), for a row that did not move.
    writeFileSync(file.replace(/\.html$/, '.sidebar-trace.json'), JSON.stringify((app.window as unknown as { __junoSidebarTrace?: unknown }).__junoSidebarTrace ?? null, null, 1))
    // The engine's and the host's logs, which say why a command failed when the page shows nothing.
    const logs = join(userData, 'logs')
    if (existsSync(logs)) cpSync(logs, file.replace(/\.html$/, '.logs'), { recursive: true })
    console.error(`dom: the failed page is in ${file}`)
  } catch { /* the window is gone */ }
}

/** Megabytes resident: this worker at its peak and now, and the hosts it forked now (Linux; 0 elsewhere). */
function memoryMB(): { readonly bunPeak: number; readonly bun: number; readonly host: number } {
  return { bunPeak: Math.round(process.resourceUsage().maxRSS / 1024), bun: Math.round(process.memoryUsage().rss / 1e6), host: Math.round(hostStats().rssPages * 4096 / 1e6) }
}

/** CPU milliseconds of the host processes this worker forked (Linux; 0 elsewhere). */
function hostCpuMillis(): number {
  return hostStats().cpuMillis
}

function hostStats(): { readonly cpuMillis: number; readonly rssPages: number } {
  if (process.platform !== 'linux') return { cpuMillis: 0, rssPages: 0 }
  let total = 0
  let rss = 0
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      if (Number(fields[1]) !== process.pid) continue
      total += (Number(fields[11]) + Number(fields[12])) * 10
      rss += Number(fields[21])
    } catch { /* gone */ }
  }
  return { cpuMillis: total, rssPages: rss }
}

/** Wall and CPU since the last lap. */
function cpuMeter() {
  const first = { at: performance.now(), cpu: process.cpuUsage(), host: hostCpuMillis() }
  let last = first
  const since = (from: typeof first) => {
    const used = process.cpuUsage(from.cpu)
    return { wall: Math.round(performance.now() - from.at), bun: Math.round((used.user + used.system) / 1000), host: hostCpuMillis() - from.host }
  }
  return {
    lap: () => {
      const result = since(last)
      last = { at: performance.now(), cpu: process.cpuUsage(), host: hostCpuMillis() }
      return result
    },
    total: () => since(first),
  }
}

import { test as base, type Browser, type BrowserContext, type ElectronApplication, type Page } from '@playwright/test'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { AgentOptions } from '../web/host/agent'
import { HostPool } from './browser/host'
import { PINNED, WebPages } from './browser/pages'
import { startWebApp } from './browser/running'
import { copySnapshot, matchingFake as matchingWebFake, snapshotState, webSnapshot, type WebSnapshot } from './browser/snapshot'
import { electronSurface, webSurface, type AppSurface } from './driver/surface'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeSlack, type FakeSlack } from '@juno/fake-slack'
import { Juno } from './driver/juno'
import { Slack } from './driver/slack'
import { startDisplay } from './display'
import { copySynced, fakeState, syncedKey, SyncedWorkspaces, type SyncedWorkspace } from './synced'
import { attachSendTrace, attachSidebarTrace } from './traces'
import { cpuAll, cpuMeter, printCpuSince } from './cpu'
import { launchApp, launchTiming, tempUserData, writeSlackApp, type Lane, type LaunchOptions, type RunningApp, type SlackAppFixture } from './launch'

export * from './launch'

export interface Fixtures {
  /** Clock installation changes the whole context; these tests discard it after use. */
  readonly freshContext: boolean
  readonly webPage: Page | undefined
  readonly otherApp: (options: AgentOptions) => Promise<Juno>
  readonly agentOptions: AgentOptions
  readonly agentLaunch: AgentOptions
  readonly timing: 'fast' | 'production' | undefined
  /** Run the engine's background AI jobs in the `running` app (`LaunchOptions.aiJobs`); `test.use({ aiJobs: true })` opts a file in. */
  readonly paced: boolean
  readonly tour: boolean
  readonly aiJobs: boolean
  /** How long the `running` app's fake AI takes to answer (`LaunchOptions.fakeAiDelayMillis`); undefined answers at once. */
  readonly fakeAiRequiresKey: boolean
  readonly fakeAiDelayMillis: number | undefined
  /** Another app is capturing the screen when the `running` app starts (`LaunchOptions.screenShared`). */
  readonly screenShared: boolean
  /** The fake releases API the `running` app checks for updates (`LaunchOptions.updateServer`); undefined leaves updates unavailable. */
  readonly updateServer: string | undefined
  /** Record the `running` app's sidebar trace and attach it to a failing test (`LaunchOptions.sidebarTrace`); `test.use({ sidebarTrace: true })` opts a file in. */
  readonly sidebarTrace: boolean
  /** Record the `running` app's send trace and attach it, with the fake's post calls, to a failing test (`LaunchOptions.sendTrace`); `test.use({ sendTrace: true })` opts a file in. */
  readonly sendTrace: boolean
  /**
   * Start signed in to the default seed and synced, from a copy built once per worker, with a
   * fake made to match it (README, "Synced start"); `test.use({ synced: true })` opts a file in.
   * Tests of sign-in, first sync and boot keep the default, a real sign-in.
   */
  readonly synced: boolean
  /** Under `synced`, the workspace the test starts from and the fake that matches it (Electron), or the snapshot (browser). */
  readonly syncedStart: { readonly workspace?: SyncedWorkspace; readonly snapshot?: WebSnapshot; readonly fake: FakeSlack } | undefined
  /** A fake Slack per test. */
  readonly fake: FakeSlack
  /** A fixture Slack-app directory with one of the fake's sessions. */
  readonly slackApp: SlackAppFixture
  readonly userData: string
  readonly running: RunningApp
  /** Under JUNO_E2E_CPU=1, counts what the test's processes burn (`cpu.ts`); `running` prints it before it closes the app. */
  readonly cpu: ReturnType<typeof cpuMeter> | undefined
  /**
   * Quits the app and opens it again on the same data folder, against the same
   * fake, and answers the driver for it: what a test needs to show that state
   * survives a relaunch. `whileClosed` runs between the two, for a test that
   * changes the data folder as the app would find it. The browser project
   * leaves the page, stops the host's engine, starts it again and loads the
   * page; what main alone keeps (launch.json, the window) is Electron's to test.
   */
  readonly relaunch: (options?: RelaunchOptions) => Promise<Juno>
  readonly app: ElectronApplication
  readonly win: Page
  readonly juno: Juno
  /** How the driver reaches menus, the clipboard and the engine's passes on this lane. */
  readonly surface: AppSurface
  /** Other people in Slack, through the fake: `slack.as('Leo').replyIn(...)`. */
  readonly slack: Slack
}

export interface WorkerFixtures {
  readonly webBrowser: () => Promise<Browser>
  readonly lane: Lane
  /** The X display this worker's apps open on; undefined on macOS and in the browser project. */
  readonly display: string | undefined
  readonly syncedWorkspaces: SyncedWorkspaces
  /** Loaded browser hosts; every lease starts a fresh engine on its test's data folder. */
  readonly hostPool: HostPool
  readonly webPages: () => Promise<WebPages>
}

type SyncOptions = Pick<LaunchOptions, 'timing' | 'fakeAiDelayMillis'>

export interface RelaunchOptions extends Pick<LaunchOptions, 'aiJobs' | 'cacheMigration' | 'tour'> {
  /** Runs while the app is closed: edit `user.db` or a launch preference here. */
  readonly whileClosed?: () => unknown
}

/** Signs in to a fresh default seed on `dir` and syncs, for `SyncedWorkspaces`. */
async function buildSynced(dir: string, options: SyncOptions): Promise<Omit<SyncedWorkspace, 'dir'>> {
  const started = performance.now()
  const startedCpu = cpuAll()
  const seedTime = Date.now()
  const fake = await startFakeSlack({ seedTime })
  const appDir = await mkdtemp(join(process.env.JUNO_TEST_SCRATCH ?? tmpdir(), 'juno-slack-app-'))
  try {
    const slackApp = await writeSlackApp(fake, appDir)
    const running = await launchApp(dir, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, ...options })
    const juno = new Juno(running.app, running.win)
    await juno.signIn().then(() => juno.waitForSync()).finally(running.close)
    if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: synced-build ${Math.round(performance.now() - started)} ms`)
    printCpuSince('synced-build', startedCpu)
    return { port: Number(new URL(fake.url).port), seedTime, sessions: fake.sessions(), fakeState: fakeState(fake) }
  } finally {
    await fake.close()
    await rm(appDir, { recursive: true, force: true })
  }
}

/** A fixture Slack-app directory with one of the fake's sessions; `remove` deletes it. */
async function slackAppFor(fake: FakeSlack): Promise<SlackAppFixture & { readonly remove: () => Promise<void> }> {
  const dir = await mkdtemp(join(process.env.JUNO_TEST_SCRATCH ?? tmpdir(), 'juno-slack-app-'))
  return { ...(await writeSlackApp(fake, dir)), remove: () => rm(dir, { recursive: true, force: true }) }
}

/** A fake that makes the synced workspace's seed again, on its port, accepting its sessions. */
function matchingFake(workspace: SyncedWorkspace): Promise<FakeSlack> {
  return startFakeSlack({ port: workspace.port, seedTime: workspace.seedTime, sessions: workspace.sessions })
}

/** Launches the app once per test with a fresh user-data directory, against its own fake Slack. */
export const test = base.extend<Fixtures, WorkerFixtures>({
  lane: ['electron', { option: true, scope: 'worker' }],
  // Every test of the worker, launchApp included, inherits DISPLAY.
  display: [
    async ({ lane }, use) => {
      if (process.platform !== 'linux' || lane === 'web') return use(undefined)
      const own = await startDisplay()
      process.env.DISPLAY = own.display
      await use(own.display)
      own.stop()
    },
    { scope: 'worker', auto: true },
  ],
  syncedWorkspaces: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const workspaces = new SyncedWorkspaces()
      await use(workspaces)
      await workspaces.close()
    },
    { scope: 'worker' },
  ],
  hostPool: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const pool = new HostPool()
      await use(pool)
      await pool.close()
    },
    { scope: 'worker' },
  ],
  webBrowser: [
    async ({ playwright, launchOptions }, use) => {
      let browser: Browser | undefined
      await use(async () => browser ??= await playwright.chromium.launch(launchOptions))
      await browser?.close()
    },
    { scope: 'worker' },
  ],
  webPages: [
    async ({ webBrowser }, use) => {
      let pages: WebPages | undefined
      await use(async () => pages ??= new WebPages(await webBrowser()))
      await pages?.close()
    },
    { scope: 'worker' },
  ],
  freshContext: [false, { option: true }],
  webPage: async ({ lane, webPages, viewport, permissions, freshContext }, use) => {
    if (lane !== 'web') return use(undefined)
    const pages = await webPages()
    if (freshContext) await pages.close()
    const page = await pages.open({ viewport, permissions })
    try { await use(page) } finally {
      await pages.release(page)
      if (freshContext) await pages.close()
    }
  },
  synced: [false, { option: true }],
  syncedStart: async ({ synced, syncedWorkspaces, timing, aiJobs, fakeAiDelayMillis, lane, webBrowser, hostPool }, use) => {
    if (!synced) return use(undefined)
    // AI jobs keep working after the first sync, so a copy would hold titles and art a fresh sign-in has not made yet.
    if (aiJobs) throw new Error('synced: true does not combine with aiJobs: true; sign in instead.')
    if (lane === 'web') {
      const snapshot = await webSnapshot(await webBrowser(), hostPool, { timing: timing ?? 'fast', ...(fakeAiDelayMillis === undefined ? {} : { fakeAiDelayMillis }) })
      const fake = await matchingWebFake(snapshot)
      try {
        if (snapshotState(fake) !== snapshot.fakeState || fake.server.sockets.size !== 0) throw new Error('The new fake does not match the synced snapshot, or already has a socket.')
        await use({ snapshot, fake })
      } finally {
        await fake.close()
      }
      return
    }
    const options: SyncOptions = { timing: launchTiming(timing === undefined ? {} : { timing }), ...(fakeAiDelayMillis === undefined ? {} : { fakeAiDelayMillis }) }
    const key = await syncedKey(options)
    let workspace = await syncedWorkspaces.get(key, (dir) => buildSynced(dir, options))
    let fake: FakeSlack
    try {
      fake = await matchingFake(workspace)
    } catch (error) {
      // Something else took the port since the build: build again on a new one.
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') throw error
      syncedWorkspaces.forget(key)
      workspace = await syncedWorkspaces.get(key, (dir) => buildSynced(dir, options))
      fake = await matchingFake(workspace)
    }
    try {
      if (fakeState(fake) !== workspace.fakeState || fake.server.sockets.size !== 0) throw new Error('The new fake does not match the synced snapshot, or already has a socket.')
      await use({ workspace, fake })
    } finally {
      await fake.close()
    }
  },
  fake: async ({ syncedStart }, use) => {
    const started = performance.now()
    const fake = syncedStart?.fake ?? await startFakeSlack()
    if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: fake ${Math.round(performance.now() - started)} ms`)
    await use(fake)
    if (syncedStart === undefined) await fake.close()
  },
  slackApp: async ({ fake }, use) => {
    const app = await slackAppFor(fake)
    await use(app)
    await app.remove()
  },
  userData: async ({ syncedStart }, use) => {
    const userData = await tempUserData()
    if (syncedStart?.workspace !== undefined) await copySynced(syncedStart.workspace, userData)
    if (syncedStart?.snapshot !== undefined) await copySnapshot(syncedStart.snapshot, userData)
    await use(userData)
    await rm(userData, { recursive: true, force: true })
  },
  otherApp: async ({ lane, fake, slackApp, hostPool, webBrowser, agentLaunch }, use) => {
    const cleanups: Array<() => Promise<void>> = []
    await use(async (options) => {
      const userData = await tempUserData()
      let context: BrowserContext | undefined
      let running: RunningApp | undefined
      cleanups.push(async () => {
        try { await running?.close() } finally {
          try { await context?.close() } finally { await rm(userData, { recursive: true, force: true }) }
        }
      })
      context = lane === 'web' ? await (await webBrowser()).newContext({ viewport: { width: 1200, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'], ...PINNED }) : undefined
      running = context === undefined
        ? await launchApp(userData, { ...agentLaunch, ...options, fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
        : await startWebApp(hostPool, await context.newPage(), fake, userData, undefined, { sidebarTrace: false, sendTrace: false, engine: { ...agentLaunch, ...options } })
      return new Juno(running.host === undefined ? electronSurface(running.app) : webSurface(running.win, running.host), running.win)
    })
    const results = await Promise.allSettled(cleanups.toReversed().map((close) => close()))
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  },
  agentOptions: [{}, { option: true }],
  agentLaunch: async ({ agentOptions }, use) => {
    const model = agentOptions.agent && agentOptions.fakeOpenRouterUrl === undefined ? await startFakeOpenRouter() : undefined
    await use({ ...agentOptions, ...(model === undefined ? {} : { fakeOpenRouterUrl: model.origin }) })
    await model?.close()
  },
  timing: [undefined, { option: true }],
  aiJobs: [false, { option: true }],
  paced: [false, { option: true }],
  tour: [false, { option: true }],
  fakeAiRequiresKey: [false, { option: true }],
  fakeAiDelayMillis: [undefined, { option: true }],
  screenShared: [false, { option: true }],
  updateServer: [undefined, { option: true }],
  sidebarTrace: [false, { option: true }],
  sendTrace: [false, { option: true }],
  // oxlint-disable-next-line no-empty-pattern
  cpu: [async ({}, use) => {
    const meter = process.env.JUNO_E2E_CPU === '1' ? cpuMeter() : undefined
    await use(meter)
    // After every other fixture's teardown, the app's close included.
    if (meter !== undefined && process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: cpu-all ${Math.round(meter.all())} ms`)
  }, { auto: true }],
  running: async ({ agentLaunch, lane, fake, slackApp, userData, syncedStart, aiJobs, paced, tour, fakeAiRequiresKey, fakeAiDelayMillis, screenShared, updateServer, sidebarTrace, sendTrace, timing, hostPool, webPage, cpu }, use, testInfo) => {
    const printCpu = () => {
      for (const [kind, millis] of Object.entries(cpu?.stop() ?? {})) console.log(`e2e timing: cpu-${kind} ${Math.round(millis)} ms`)
    }
    if (lane === 'web') {
      const page = webPage!
      if (screenShared || updateServer !== undefined) throw new Error('screenShared and updateServer are Electron launch options; tag the test @electron.')
      const running = await startWebApp(hostPool, page, fake, userData, syncedStart?.snapshot, {
        sidebarTrace, sendTrace, tour, engine: { ...agentLaunch, timing: launchTiming({ paced, ...(timing === undefined ? {} : { timing }) }), aiJobs, paced, fakeAiRequiresKey, ...(fakeAiDelayMillis === undefined ? {} : { fakeAiDelayMillis }) },
      })
      await use(running)
      if (sidebarTrace && testInfo.status !== testInfo.expectedStatus) await attachSidebarTrace(page, testInfo)
      if (sendTrace && testInfo.status !== testInfo.expectedStatus) await attachSendTrace(page, fake, testInfo)
      printCpu()
      await running.close()
      return
    }
    const running = await launchApp(userData, {
      ...agentLaunch,
      fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword,
      ...(timing === undefined ? {} : { timing }),
      aiJobs, paced, tour, fakeAiRequiresKey, screenShared, sidebarTrace, sendTrace, ...(fakeAiDelayMillis === undefined ? {} : { fakeAiDelayMillis }),
      ...(updateServer === undefined ? {} : { updateServer }),
    })
    if (syncedStart !== undefined) {
      try {
        await new Juno(running.app, running.win).waitForSync()
        // The app booted from a copy of another fake's sync; a difference would make every later step misleading.
        if (fakeState(fake) !== syncedStart.workspace?.fakeState || fake.server.sockets.size !== 1) throw new Error('The fake no longer matches the synced workspace this test started from. Something in the test setup or the warm boot changed the fake; sign in instead (synced: false), or remove the difference.')
      } catch (error) {
        await running.close()
        throw error
      }
    }
    await use(running)
    if (sidebarTrace && testInfo.status !== testInfo.expectedStatus) await attachSidebarTrace(running.win, testInfo)
    if (sendTrace && testInfo.status !== testInfo.expectedStatus) await attachSendTrace(running.win, fake, testInfo)
    printCpu()
    await running.close()
  },
  relaunch: async ({ agentLaunch, lane, running, fake, slackApp, userData, aiJobs, paced, tour, fakeAiRequiresKey, fakeAiDelayMillis, timing, webPage }, use) => {
    let latest: RunningApp = running
    await use(async ({ whileClosed, ...options } = {}) => {
      if (lane === 'web') {
        const page = webPage!
        const host = running.host!
        await page.goto('about:blank')
        await host.quitEngine()
        await whileClosed?.()
        await host.startEngine({ ...(options.aiJobs === undefined ? {} : { aiJobs: options.aiJobs }), ...(options.cacheMigration === undefined ? {} : { cacheMigration: options.cacheMigration }) })
        await page.goto(`${host.url}?e2e=1${(options.tour ?? tour) ? "&tour=auto" : ""}`)
        return new Juno(webSurface(page, host), page)
      }
      await latest.close()
      await whileClosed?.()
      latest = await launchApp(userData, {
        ...agentLaunch,
        fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword,
        ...(timing === undefined ? {} : { timing }), aiJobs, paced, tour, fakeAiRequiresKey, ...(fakeAiDelayMillis === undefined ? {} : { fakeAiDelayMillis }),
        ...options,
      })
      return new Juno(latest.app, latest.win)
    })
    if (latest !== running) await latest.close()
  },
  app: async ({ running }, use) => {
    await use(running.app)
  },
  win: async ({ running }, use) => {
    await use(running.win)
  },

  surface: async ({ running }, use) => {
    await use(running.host === undefined ? electronSurface(running.app) : webSurface(running.win, running.host))
  },
  juno: async ({ running, surface }, use) => {
    await use(new Juno(surface, running.win))
  },
  slack: async ({ fake }, use) => {
    await use(new Slack(fake))
  },
})

/** A test that starts signed in and synced (`synced: true`), for a file whose other tests sign in themselves. */
export const syncedTest = test.extend({ synced: true })

export { hooks } from './hooks'

export { expect } from '@playwright/test'

import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { startFakeSlack, writeSlackAppFixture, type Credentials, type FakeSlack } from '@juno/fake-slack'
import { Juno } from './driver/juno'
import { Slack } from './driver/slack'
import { startDisplay } from './display'
import { copySynced, fakeState, SyncedWorkspaces, type SyncedWorkspace } from './synced'
import { attachSendTrace, attachSidebarTrace, startSendTrace, startSidebarTrace } from './traces'

/** What main exposes on `globalThis.junoTest` under JUNO_E2E. */
export interface JunoTestHooks {
  readonly enginePid: () => number | undefined
  readonly aiCalls: () => Record<string, number>
  readonly engineState: () => string
  /** Makes the supervisor give up on the engine, as after too many crashes. */
  readonly failEngine: () => void
  /** `stopped` until a provider is set up: launch with `agent: true`, or set one through `window.juno.agent`. */
  readonly agentState: () => string
  /** The host name from the agent's `host.hello`, once it reached the engine. */
  readonly agentHost: () => string | undefined
  readonly agentPid: () => number | undefined
  /** The OS notifications main showed, recorded instead of shown. */
  readonly notifications: () => Array<{ readonly title: string; readonly body: string }>
  readonly clickNotification: (index?: number) => void
  readonly dockBadge: () => string
  /** How many times Open Notification Settings opened System Settings. */
  readonly notificationSettingsOpened: () => number
  /** As if the Mac woke from sleep. */
  readonly wake: () => void
}

export interface RunningApp {
  readonly app: ElectronApplication
  readonly win: Page
  readonly close: () => Promise<void>
}

/** The OpenRouter key an `agent: true` launch starts with. */
export const E2E_OPENROUTER_KEY = 'sk-or-v1-e2e-launch-0123456789abcdef'

/** A throwaway user-data directory. Delete it with `rm` when done. */
export function tempUserData(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'juno-e2e-'))
}

export interface LaunchOptions {
  /** Engine scheduling profile. Timing, perf, feel and @mac checks retain production defaults. */
  readonly timing?: 'fast' | 'production'
  /** The fake Slack the app signs in against (sign-in window, socket allow-list). */
  readonly fakeSlackUrl?: string
  /** A fixture Slack-app directory for "Use the Slack app's session". */
  readonly slackAppDir?: string
  /** The stand-in for the "Slack Safe Storage" keychain password. */
  readonly keychainPassword?: string
  /**
   * Start with OpenRouter set up (a test key, `JUNO_E2E_OPENROUTER_KEY`), so
   * the Juno Agent runs from launch. Without `fakeOpenRouterUrl`, a fake
   * OpenRouter is started for the launch. With no provider the agent does
   * not run.
   */
  readonly agent?: boolean
  /** The fake OpenRouter the agent reads its catalogue from and sends chat requests to. */
  readonly fakeOpenRouterUrl?: string
  /** This app's name in the backup, so two launches can play two Macs (`JUNO_E2E_DEVICE_NAME`). */
  readonly deviceName?: string
  /** How often the backup exports, in place of once a minute (`JUNO_E2E_BACKUP_INTERVAL_MS`). */
  readonly backupIntervalMs?: number
  /** How long the engine's fake AI takes to answer; past a task's timeout it gives no answer. */
  readonly fakeAiDelayMillis?: number
  /** The fake AI answers only once Settings has an OpenRouter key, as the live provider does. */
  readonly fakeAiRequiresKey?: boolean
  /** Run the engine's background AI jobs: titles, art, Home's AI items, Juno's Automated check (`JUNO_E2E_AI_JOBS`). Off by default. */
  readonly aiJobs?: boolean
  /** The `agent.codemode` flag (`JUNO_AGENT_CODEMODE`): the agent may run read-only scripts. */
  readonly codemode?: boolean
  /** Another app is already capturing the screen when Juno starts (`JUNO_E2E_SCREEN_SHARED`, the screen watch's seam). */
  readonly screenShared?: boolean
  /** Play the next build: the engine opens the cache with one more migration (`JUNO_E2E_CACHE_MIGRATION`). */
  readonly cacheMigration?: boolean
  /** Keep the production request pacing against the fake (`JUNO_E2E_FAKE_PACED`), to time a first sync. */
  readonly paced?: boolean
  /** The welcome card shows by itself, as outside tests (`JUNO_E2E_TOUR`). Without it, only Help, ⌘K and Settings › About bring it. */
  readonly tour?: boolean
  /** A fake of the releases repository's GitHub API, so updates are available (`JUNO_E2E_UPDATE_SERVER`). */
  readonly updateServer?: string
  /** Record the sidebar's order hold and topic list values in the main window (`sidebarTrace.ts` in `@juno/state`; README, "Sidebar trace"). */
  readonly sidebarTrace?: boolean
  /** Record a send's path through the main window (`sendTrace.ts` in `@juno/state`; README, "Send trace"). */
  readonly sendTrace?: boolean
}

let launches = 0

/**
 * Under JUNO_COVERAGE=1, a directory of its own for this launch's coverage,
 * under the spec file it belongs to (e2e/coverage.ts reduces them after the run).
 */
function coverageDir(): string | undefined {
  if (process.env.JUNO_COVERAGE !== '1') return undefined
  let spec = 'unknown'
  try {
    spec = relative(resolve(__dirname, '..'), base.info().file)
  } catch {
    // Outside a test or hook: the launch counts for no spec.
  }
  return resolve(__dirname, '../coverage/raw', spec.replaceAll('/', '__'), `${process.pid}-${launches++}`)
}

/**
 * Launches the built app (prepared by Playwright setup) on the given user-data
 * directory and waits for its first window. Launch the same directory twice
 * to test what survives a relaunch.
 */
export async function launchApp(userData: string, options: LaunchOptions = {}): Promise<RunningApp> {
  const started = performance.now()
  const env: Record<string, string> = {}
  // pnpm's global virtual store gives the scripts it runs NODE_PATH and a
  // NODE_OPTIONS resolve hook. The app is bundled and the packaged app gets
  // neither, so the app under test does not either.
  const dropped = new Set(['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH'])
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !dropped.has(key)) env[key] = value
  }
  env.JUNO_USER_DATA = userData
  env.JUNO_E2E = '1'
  const info = base.info()
  const production = options.paced === true || /(?:perf|idle-cpu)\.spec\.ts$|[/\\]feel[/\\]/.test(info.file) || info.tags.includes('@mac')
  env.JUNO_E2E_FAST_TIMING = (options.timing ?? (production ? 'production' : 'fast')) === 'fast' ? '1' : '0'
  delete env.JUNO_E2E_OPENROUTER_KEY
  env.JUNO_FAKE_AI_REQUIRES_KEY = options.fakeAiRequiresKey === true ? '1' : '0'
  if (options.fakeSlackUrl !== undefined) env.JUNO_FAKE_SLACK_URL = options.fakeSlackUrl
  if (options.slackAppDir !== undefined) env.JUNO_SLACK_APP_DIR = options.slackAppDir
  if (options.keychainPassword !== undefined) env.JUNO_SLACK_SAFE_STORAGE_PASSWORD = options.keychainPassword
  if (options.fakeAiDelayMillis !== undefined) env.JUNO_FAKE_AI_DELAY_MS = String(options.fakeAiDelayMillis)
  const ownOpenRouter = options.agent === true && options.fakeOpenRouterUrl === undefined ? await startFakeOpenRouter() : undefined
  if (options.agent === true) env.JUNO_E2E_OPENROUTER_KEY = E2E_OPENROUTER_KEY
  const openRouterUrl = options.fakeOpenRouterUrl ?? ownOpenRouter?.origin
  if (openRouterUrl !== undefined) env.JUNO_FAKE_OPENROUTER_URL = openRouterUrl
  if (options.deviceName !== undefined) env.JUNO_E2E_DEVICE_NAME = options.deviceName
  if (options.codemode === true) env.JUNO_AGENT_CODEMODE = '1'
  if (options.screenShared === true) env.JUNO_E2E_SCREEN_SHARED = '1'
  if (options.cacheMigration === true) env.JUNO_E2E_CACHE_MIGRATION = '1'
  if (options.paced === true) env.JUNO_E2E_FAKE_PACED = '1'
  if (options.tour === true) env.JUNO_E2E_TOUR = '1'
  if (options.updateServer !== undefined) env.JUNO_E2E_UPDATE_SERVER = options.updateServer
  else delete env.JUNO_E2E_UPDATE_SERVER
  if (options.aiJobs === true) env.JUNO_E2E_AI_JOBS = '1'
  else delete env.JUNO_E2E_AI_JOBS
  if (options.backupIntervalMs !== undefined) env.JUNO_E2E_BACKUP_INTERVAL_MS = String(options.backupIntervalMs)
  const coverage = coverageDir()
  if (coverage !== undefined) env.JUNO_E2E_COVERAGE = coverage

  // Launch the package directory (like `electron .`), not the script, so
  // Electron reads package.json for the app name and version.
  const app = await electron.launch({
    // Under xvfb (pnpm remote) Chromium may find no pointing device and match
    // `(hover: none)`, which turns off every hover style. Say there is a mouse.
    args: [...(process.platform === 'linux' ? ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'] : []), resolve(__dirname, '..')],
    env,
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  if (options.sidebarTrace === true) {
    // On this page now, and on any later load.
    await app.context().addInitScript(startSidebarTrace)
    await win.evaluate(startSidebarTrace)
  }
  if (options.sendTrace === true) {
    await app.context().addInitScript(startSendTrace)
    await win.evaluate(startSendTrace)
  }
  if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: launch ${Math.round(performance.now() - started)} ms`)
  return {
    app,
    win,
    close: async () => {
      // Main and the renderers write what ran since their last write; the engine and the agent write as they end.
      if (coverage !== undefined) await app.evaluate(() => (globalThis as unknown as { junoTest: { flushCoverage: () => Promise<void> } }).junoTest.flushCoverage()).catch(() => undefined)
      const closing = performance.now()
      await app.close()
      if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: close ${Math.round(performance.now() - closing)} ms`)
      await ownOpenRouter?.close()
    },
  }
}

/** The fixture Slack-app directory the app imports from, written with one of the fake's sessions. */
export interface SlackAppFixture {
  readonly dir: string
  readonly keychainPassword: string
  readonly credentials: Credentials
}

export const KEYCHAIN_PASSWORD = 'fixture-keychain-password'

export async function writeSlackApp(
  fake: FakeSlack,
  dir: string,
  options: Pick<Parameters<typeof writeSlackAppFixture>[1], 'cookiesFile' | 'signedOut'> = {},
): Promise<SlackAppFixture> {
  const credentials = fake.signIn()
  await writeSlackAppFixture(dir, {
    team: { id: fake.teamId, name: 'Juno Fake', domain: 'juno-fake', url: `${fake.url}/`, token: credentials.token, userId: credentials.userId },
    cookie: credentials.cookie,
    keychainPassword: KEYCHAIN_PASSWORD,
    ...options,
  })
  return { dir, keychainPassword: KEYCHAIN_PASSWORD, credentials }
}

export interface Fixtures {
  readonly timing: 'fast' | 'production' | undefined
  /** Run the engine's background AI jobs in the `running` app (`LaunchOptions.aiJobs`); `test.use({ aiJobs: true })` opts a file in. */
  readonly aiJobs: boolean
  /** How long the `running` app's fake AI takes to answer (`LaunchOptions.fakeAiDelayMillis`); undefined answers at once. */
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
  /** Under `synced`, the workspace the test starts from and the fake that matches it. */
  readonly syncedStart: { readonly workspace: SyncedWorkspace; readonly fake: FakeSlack } | undefined
  /** A fake Slack per test. */
  readonly fake: FakeSlack
  /** A fixture Slack-app directory with one of the fake's sessions. */
  readonly slackApp: SlackAppFixture
  readonly userData: string
  readonly running: RunningApp
  readonly app: ElectronApplication
  readonly win: Page
  readonly juno: Juno
  /** Other people in Slack, through the fake: `slack.as('Leo').replyIn(...)`. */
  readonly slack: Slack
}

export interface WorkerFixtures {
  /** The X display this worker's apps open on; undefined on macOS. */
  readonly display: string | undefined
  readonly syncedWorkspaces: SyncedWorkspaces
}

type SyncOptions = Pick<LaunchOptions, 'timing' | 'fakeAiDelayMillis'>

/** Signs in to a fresh default seed on `dir` and syncs, for `SyncedWorkspaces`. */
async function buildSynced(dir: string, options: SyncOptions): Promise<Omit<SyncedWorkspace, 'dir'>> {
  const started = performance.now()
  const seedTime = Date.now()
  const fake = await startFakeSlack({ seedTime })
  const appDir = await mkdtemp(join(tmpdir(), 'juno-slack-app-'))
  try {
    const slackApp = await writeSlackApp(fake, appDir)
    const running = await launchApp(dir, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, ...options })
    const juno = new Juno(running.app, running.win)
    await juno.signIn().then(() => juno.waitForSync()).finally(running.close)
    if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: synced-build ${Math.round(performance.now() - started)} ms`)
    return { port: Number(new URL(fake.url).port), seedTime, sessions: fake.sessions(), fakeState: fakeState(fake) }
  } finally {
    await fake.close()
    await rm(appDir, { recursive: true, force: true })
  }
}

/** A fake that makes the synced workspace's seed again, on its port, accepting its sessions. */
function matchingFake(workspace: SyncedWorkspace): Promise<FakeSlack> {
  return startFakeSlack({ port: workspace.port, seedTime: workspace.seedTime, sessions: workspace.sessions })
}

/** Launches the app once per test with a fresh user-data directory, against its own fake Slack. */
export const test = base.extend<Fixtures, WorkerFixtures>({
  // Every test of the worker, launchApp included, inherits DISPLAY.
  display: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      if (process.platform !== 'linux') return use(undefined)
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
  synced: [false, { option: true }],
  syncedStart: async ({ synced, syncedWorkspaces, timing, aiJobs, fakeAiDelayMillis }, use) => {
    if (!synced) return use(undefined)
    // AI jobs keep working after the first sync, so a copy would hold titles and art a fresh sign-in has not made yet.
    if (aiJobs) throw new Error('synced: true does not combine with aiJobs: true; sign in instead.')
    const options: SyncOptions = { ...(timing === undefined ? {} : { timing }), ...(fakeAiDelayMillis === undefined ? {} : { fakeAiDelayMillis }) }
    const key = JSON.stringify(options)
    let workspace = await syncedWorkspaces.get(key, (dir) => buildSynced(dir, options))
    let fake: FakeSlack
    try {
      fake = await matchingFake(workspace)
    } catch (error) {
      // Something else took the port since the build: build again on a new one.
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
      syncedWorkspaces.forget(key)
      workspace = await syncedWorkspaces.get(key, (dir) => buildSynced(dir, options))
      fake = await matchingFake(workspace)
    }
    await use({ workspace, fake })
  },
  fake: async ({ syncedStart }, use) => {
    const started = performance.now()
    const fake = syncedStart?.fake ?? await startFakeSlack()
    if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: fake ${Math.round(performance.now() - started)} ms`)
    await use(fake)
    await fake.close()
  },
  slackApp: async ({ fake }, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'juno-slack-app-'))
    await use(await writeSlackApp(fake, dir))
    await rm(dir, { recursive: true, force: true })
  },
  userData: async ({ syncedStart }, use) => {
    const userData = await tempUserData()
    if (syncedStart !== undefined) await copySynced(syncedStart.workspace, userData)
    await use(userData)
    await rm(userData, { recursive: true, force: true })
  },
  timing: [undefined, { option: true }],
  aiJobs: [false, { option: true }],
  fakeAiDelayMillis: [undefined, { option: true }],
  screenShared: [false, { option: true }],
  updateServer: [undefined, { option: true }],
  sidebarTrace: [false, { option: true }],
  sendTrace: [false, { option: true }],
  running: async ({ fake, slackApp, userData, syncedStart, aiJobs, fakeAiDelayMillis, screenShared, updateServer, sidebarTrace, sendTrace, timing }, use, testInfo) => {
    const running = await launchApp(userData, {
      fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword,
      ...(timing === undefined ? {} : { timing }),
      aiJobs, screenShared, sidebarTrace, sendTrace, ...(fakeAiDelayMillis === undefined ? {} : { fakeAiDelayMillis }),
      ...(updateServer === undefined ? {} : { updateServer }),
    })
    if (syncedStart !== undefined) {
      try {
        await new Juno(running.app, running.win).waitForSync()
        // The app booted from a copy of another fake's sync; a difference would make every later step misleading.
        if (fakeState(fake) !== syncedStart.workspace.fakeState) throw new Error('The fake no longer matches the synced workspace this test started from. Something in the test setup or the warm boot changed the fake; sign in instead (synced: false), or remove the difference.')
      } catch (error) {
        await running.close()
        throw error
      }
    }
    await use(running)
    if (sidebarTrace && testInfo.status !== testInfo.expectedStatus) await attachSidebarTrace(running.win, testInfo)
    if (sendTrace && testInfo.status !== testInfo.expectedStatus) await attachSendTrace(running.win, fake, testInfo)
    await running.close()
  },
  app: async ({ running }, use) => {
    await use(running.app)
  },
  win: async ({ running }, use) => {
    await use(running.win)
  },

  juno: async ({ running }, use) => {
    await use(new Juno(running.app, running.win))
  },
  slack: async ({ fake }, use) => {
    await use(new Slack(fake))
  },
})

/** A test that starts signed in and synced (`synced: true`), for a file whose other tests sign in themselves. */
export const syncedTest = test.extend({ synced: true })

/** Reads one of main's test hooks. */
export function hooks<K extends keyof JunoTestHooks>(app: ElectronApplication, name: K): Promise<ReturnType<JunoTestHooks[K]>> {
  return app.evaluate((_electron, hook) => {
    const testHooks = (globalThis as unknown as { junoTest: JunoTestHooks }).junoTest
    return testHooks[hook]() as ReturnType<JunoTestHooks[K]>
  }, name)
}

export { expect } from '@playwright/test'

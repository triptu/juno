import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { startFakeSlack, writeSlackAppFixture, type Credentials, type FakeSlack } from '@juno/fake-slack'
import { Juno } from './driver/juno'
import { Slack } from './driver/slack'

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
  /** The `agent.codemode` flag (`JUNO_AGENT_CODEMODE`): the agent may run read-only scripts. */
  readonly codemode?: boolean
  /** Play the next build: the engine opens the cache with one more migration (`JUNO_E2E_CACHE_MIGRATION`). */
  readonly cacheMigration?: boolean
  /** Keep the production request pacing against the fake (`JUNO_E2E_FAKE_PACED`), to time a first sync. */
  readonly paced?: boolean
}

/**
 * Launches the built app (prepared by Playwright setup) on the given user-data
 * directory and waits for its first window. Launch the same directory twice
 * to test what survives a relaunch.
 */
export async function launchApp(userData: string, options: LaunchOptions = {}): Promise<RunningApp> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  env.JUNO_USER_DATA = userData
  env.JUNO_E2E = '1'
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
  if (options.cacheMigration === true) env.JUNO_E2E_CACHE_MIGRATION = '1'
  if (options.paced === true) env.JUNO_E2E_FAKE_PACED = '1'
  if (options.backupIntervalMs !== undefined) env.JUNO_E2E_BACKUP_INTERVAL_MS = String(options.backupIntervalMs)

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
  return {
    app,
    win,
    close: async () => {
      await app.close()
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

/**
 * Starts an X server of its own (Linux only) and returns its display, such
 * as `:12`. Workers that share one display stack their windows at the same
 * place, and when another test's window maps or closes over this one, X
 * sends crossing events at the real pointer, which Chromium takes as a
 * mouse move: hover jumps away from where the test put the mouse.
 */
async function startDisplay(): Promise<{ readonly display: string; readonly stop: () => void }> {
  const xvfb = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] })
  let errors = ''
  xvfb.stderr?.on('data', (chunk: Buffer) => (errors += chunk))
  const number = await new Promise<string>((resolve, reject) => {
    xvfb.stdio[3]?.on('data', (chunk: Buffer) => resolve(String(chunk).trim()))
    xvfb.once('error', reject)
    xvfb.once('exit', (code) => reject(new Error(`Xvfb exited with ${code}: ${errors}`)))
  })
  return { display: `:${number}`, stop: () => xvfb.kill() }
}

export interface WorkerFixtures {
  /** The X display this worker's apps open on; undefined on macOS. */
  readonly display: string | undefined
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
  // Playwright requires the destructuring pattern even with no dependencies.
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack()
    await use(fake)
    await fake.close()
  },
  slackApp: async ({ fake }, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'juno-slack-app-'))
    await use(await writeSlackApp(fake, dir))
    await rm(dir, { recursive: true, force: true })
  },
  // oxlint-disable-next-line no-empty-pattern
  userData: async ({}, use) => {
    const userData = await tempUserData()
    await use(userData)
    await rm(userData, { recursive: true, force: true })
  },
  running: async ({ fake, slackApp, userData }, use) => {
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
    await use(running)
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

/** Reads one of main's test hooks. */
export function hooks<K extends keyof JunoTestHooks>(app: ElectronApplication, name: K): Promise<ReturnType<JunoTestHooks[K]>> {
  return app.evaluate((_electron, hook) => {
    const testHooks = (globalThis as unknown as { junoTest: JunoTestHooks }).junoTest
    return testHooks[hook]() as ReturnType<JunoTestHooks[K]>
  }, name)
}

export { expect } from '@playwright/test'

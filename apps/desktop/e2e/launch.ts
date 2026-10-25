import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { writeSlackAppFixture, type Credentials, type FakeSlack } from '@juno/fake-slack'
import type { TestHost } from './browser/host'
import { cpuAll, printCpuSince } from './cpu'
import { startSendTrace, startSidebarTrace } from './traces'

/**
 * Launching the built Electron app for a test, and the Slack-app fixture it
 * signs in from. The fixtures (`fixtures.ts`) re-export all of it.
 */
export interface RunningApp {
  /** The Electron app; the browser project has none, and reading it fails the test with a pointer to `@electron`. */
  readonly app: ElectronApplication
  readonly win: Page
  readonly close: () => Promise<void>
  /** The browser project's host for this test; undefined on Electron. */
  readonly host?: TestHost
}

/** Which app a project runs: Electron's, or the renderer in a browser against a test host (README, "Browser lane"). */
export type Lane = 'electron' | 'web'

/** The OpenRouter key an `agent: true` launch starts with. */
export const E2E_OPENROUTER_KEY = 'sk-or-v1-e2e-launch-0123456789abcdef'

/** A throwaway user-data directory. Delete it with `rm` when done. */
export function tempUserData(): Promise<string> {
  return mkdtemp(join(process.env.JUNO_TEST_SCRATCH ?? tmpdir(), 'juno-e2e-'))
}

export interface LaunchOptions {
  /** A crash point armed only in this app’s child environment. */
  readonly agentCrash?: string
  readonly notificationResponse?: 'denied'
  readonly notificationInitial?: 'notDetermined'
  readonly developmentNotifications?: boolean
  /** Engine scheduling profile. Timing, perf, feel and @mac checks retain production defaults. */
  readonly timing?: 'fast' | 'production'
  /** The fake Slack the app signs in against (API and socket allow-list). */
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
export function coverageDir(): string | undefined {
  if (process.env.JUNO_COVERAGE !== '1') return undefined
  let spec = 'unknown'
  try {
    spec = relative(resolve(__dirname, '..'), base.info().file)
  } catch {
    // Outside a test or hook: the launch counts for no spec.
  }
  return resolve(__dirname, '../coverage/raw', spec.replaceAll('/', '__'), `${process.pid}-${launches++}`)
}

export function launchTiming(options: LaunchOptions): 'fast' | 'production' {
  const info = base.info()
  const production = options.paced === true || /(?:perf|idle-cpu)\.spec\.ts$|[/\\]feel[/\\]/.test(info.file) || info.tags.includes('@mac')
  return options.timing ?? (production ? 'production' : 'fast')
}

/**
 * Launches the built app (prepared by Playwright setup) on the given user-data
 * directory and waits for its first window. Launch the same directory twice
 * to test what survives a relaunch.
 */
export async function launchApp(userData: string, options: LaunchOptions = {}): Promise<RunningApp> {
  const started = performance.now()
  const startedCpu = cpuAll()
  const env: Record<string, string> = {}
  // A package manager or test runner may give the scripts it runs NODE_PATH
  // or NODE_OPTIONS. The app is bundled and the packaged app gets neither, so
  // the app under test does not either.
  const dropped = new Set(['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH'])
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !dropped.has(key)) env[key] = value
  }
  if (options.agentCrash !== undefined) env.JUNO_AGENT_CRASH_AT = options.agentCrash
  else delete env.JUNO_AGENT_CRASH_AT
  env.JUNO_USER_DATA = userData
  env.JUNO_E2E = '1'
  if (options.notificationResponse) env.JUNO_E2E_NOTIFICATION_RESPONSE = options.notificationResponse
  if (options.notificationInitial) env.JUNO_E2E_NOTIFICATION_INITIAL = options.notificationInitial
  if (options.developmentNotifications) env.JUNO_E2E_DEV_NOTIFICATIONS = '1'
  env.JUNO_E2E_FAST_TIMING = launchTiming(options) === 'fast' ? '1' : '0'
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
    // Under xvfb (bun run remote) Chromium may find no pointing device and match
    // `(hover: none)`, which turns off every hover style. Say there is a mouse.
    args: [...(process.platform === 'linux' ? ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'] : []), resolve(__dirname, '..')],
    env,
    // The fake HTTP image origin stands in for Slack's HTTPS CDN. Only the test context bypasses CSP.
    bypassCSP: options.fakeSlackUrl !== undefined,
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
  printCpuSince('launch', startedCpu)
  return {
    app,
    win,
    close: async () => {
      // Main and the renderers write what ran since their last write; the engine and the agent write as they end.
      if (coverage !== undefined) await app.evaluate(() => (globalThis as unknown as { junoTest: { flushCoverage: () => Promise<void> } }).junoTest.flushCoverage()).catch(() => undefined)
      const closing = performance.now()
      const closingCpu = cpuAll()
      await app.close()
      if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: close ${Math.round(performance.now() - closing)} ms`)
      printCpuSince('close', closingCpu)
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

import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** What main exposes on `globalThis.junoTest` under JUNO_E2E. */
export interface JunoTestHooks {
  readonly enginePid: () => number | undefined
  readonly engineState: () => string
  /** Makes the supervisor give up on the engine, as after too many crashes. */
  readonly failEngine: () => void
}

export interface RunningApp {
  readonly app: ElectronApplication
  readonly win: Page
  readonly close: () => Promise<void>
}

/** A throwaway user-data directory. Delete it with `rm` when done. */
export function tempUserData(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'juno-e2e-'))
}

/**
 * Launches the built app (run `pnpm build` first) on the given user-data
 * directory and waits for its first window. Launch the same directory twice
 * to test what survives a relaunch.
 */
export async function launchApp(userData: string): Promise<RunningApp> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  env.JUNO_USER_DATA = userData
  env.JUNO_E2E = '1'

  // Launch the package directory (like `electron .`), not the script, so
  // Electron reads package.json for the app name and version.
  const app = await electron.launch({
    args: [resolve(__dirname, '..')],
    env,
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  return { app, win, close: () => app.close() }
}

/** Launches the app once per test with a fresh user-data directory. */
export const test = base.extend<{ running: RunningApp; app: ElectronApplication; win: Page }>({
  // Playwright requires the destructuring pattern even with no dependencies.
  // oxlint-disable-next-line no-empty-pattern
  running: async ({}, use) => {
    const userData = await tempUserData()
    const running = await launchApp(userData)
    await use(running)
    await running.close()
    await rm(userData, { recursive: true, force: true })
  },
  app: async ({ running }, use) => {
    await use(running.app)
  },
  win: async ({ running }, use) => {
    await use(running.win)
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

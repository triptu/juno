import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Launches the built app (run `pnpm build` first) with a throwaway user-data
 * directory, and hands tests the first window as `win`.
 */
export const test = base.extend<{ app: ElectronApplication; win: Page }>({
  // Playwright requires the destructuring pattern even with no dependencies.
  // oxlint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const userData = await mkdtemp(join(tmpdir(), 'juno-e2e-'))
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
    }
    env.JUNO_USER_DATA = userData

    // Launch the package directory (like `electron .`), not the script, so
    // Electron reads package.json for the app name and version.
    const app = await electron.launch({
      args: [resolve(__dirname, '..')],
      env,
    })
    await use(app)
    await app.close()
    await rm(userData, { recursive: true, force: true })
  },
  win: async ({ app }, use) => {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await use(win)
  },
})

export { expect } from '@playwright/test'

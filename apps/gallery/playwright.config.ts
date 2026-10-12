import { defineConfig } from '@playwright/test'

const port = 4174

/**
 * Screenshots every fixture in light and dark. Uses the installed Google
 * Chrome (`channel: 'chrome'`) so no browser download is needed; set
 * GALLERY_BROWSER=chromium after `npx playwright install chromium` to use
 * Playwright's own build instead.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'shots.spec.ts',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    channel: process.env.GALLERY_BROWSER === 'chromium' ? undefined : 'chrome',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  },
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})

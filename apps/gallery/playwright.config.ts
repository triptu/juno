import { defineConfig } from '@playwright/test'

const port = 4174

/**
 * Two projects against the built gallery. `shots` screenshots every fixture
 * in light and dark; `behaviour` checks what a screenshot cannot show
 * (mouse-down activation, the cursor rule). Both use the installed Google
 * Chrome (`channel: 'chrome'`) so no browser download is needed; set
 * GALLERY_BROWSER=chromium after `npx playwright install chromium` to use
 * Playwright's own build instead.
 */
export default defineConfig({
  testDir: '.',
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
  projects: [
    { name: 'shots', testMatch: 'shots.spec.ts' },
    { name: 'behaviour', testMatch: 'behaviour.spec.ts' },
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})

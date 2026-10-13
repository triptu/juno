import { defineConfig } from '@playwright/test'

const port = 4174

/**
 * Two projects against the built gallery. `shots` screenshots every state
 * in light and dark; `behaviour` checks what a screenshot cannot show
 * (mouse-down activation, the cursor rule, the state switcher) and runs the
 * layout-shift guard over every interactive element. Both use the installed Google
 * Chrome (`channel: 'chrome'`) so no browser download is needed; set
 * GALLERY_BROWSER=chromium after `npx playwright install chromium` to use
 * Playwright's own build instead.
 */
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  // Tests are independent pages against a static server. The shift guard
  // splits itself into parts to use the workers.
  workers: process.env.CI ? 2 : 3,
  fullyParallel: true,
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
    // Wide enough for the 240px switcher plus the widest frame (1400px).
    { name: 'shots', testMatch: 'shots.spec.ts', use: { viewport: { width: 1800, height: 1000 } } },
    { name: 'behaviour', testMatch: ['behaviour.spec.ts', 'shift.spec.ts'] },
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})

import { defineConfig } from '@playwright/test'

// GALLERY_PORT lets two worktrees run the tests at the same time.
const port = Number(process.env.GALLERY_PORT ?? 4174)
// One id per run, set before the workers start, so the shift guard's parts share one queue.
process.env.GALLERY_SHIFT_RUN ??= `${Date.now()}-${process.pid}`
// JUNO_SHARD=i/n (pnpm remote --shards n): shard 0 runs every test; the others
// run only the shift guard's parts, which split the states between the shards.
const shardIndex = Number(/^(\d+)\/\d+$/.exec(process.env.JUNO_SHARD ?? '')?.[1] ?? 0)

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
  // GALLERY_WORKERS lets a machine of its own (pnpm remote) run more.
  workers: Number(process.env.GALLERY_WORKERS ?? (process.env.CI ? 2 : 3)),
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
  ...(shardIndex > 0 ? { grep: /no interaction shifts the layout, in any state of any component/ } : {}),
  projects: [
    // Wide enough for the 240px switcher plus the widest frame (1400px).
    { name: 'shots', testMatch: 'shots.spec.ts', use: { viewport: { width: 1800, height: 1000 } } },
    { name: 'behaviour', testMatch: ['behaviour.spec.ts', 'shift.spec.ts', 'geometry.spec.ts', 'settings.spec.ts'] },
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})

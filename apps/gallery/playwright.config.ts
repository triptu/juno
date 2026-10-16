import { defineConfig } from '@playwright/test'

// Each worktree gets its own port, so a local run never reuses a gallery
// server another worktree left running (reuseExistingServer below).
// GALLERY_PORT overrides it.
const worktreeOffset = [...import.meta.dirname].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 997, 7)
const port = Number(process.env.GALLERY_PORT ?? 4174 + worktreeOffset)
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
    // Every other spec, so a branch that adds one does not edit this line.
    { name: 'behaviour', testMatch: '*.spec.ts', testIgnore: ['shots.spec.ts', '**/node_modules/**'] },
    // The tour's screenshots (pnpm tour:shots), written into packages/views/src/tour/shots.
    { name: 'tour', testMatch: 'tour-shots.ts' },
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})

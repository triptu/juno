import { createServer } from 'node:net'
import { defineConfig } from '@playwright/test'

// Ask the OS for a free port for this run. Never connect to a previous run's server.
const port = process.env.GALLERY_TEST_PORT ? Number(process.env.GALLERY_TEST_PORT) : await new Promise<number>((resolve, reject) => {
  const server = createServer()
  server.on('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('No gallery port assigned')
    server.close(error => error ? reject(error) : resolve(address.port))
  })
})
process.env.GALLERY_TEST_PORT = String(port)
// One id per run, set before the workers start, so the shift guard's parts share one queue.
process.env.GALLERY_SHIFT_RUN ??= `${Date.now()}-${process.pid}`
// JUNO_SHARD=i/n (bun run remote --shards n): shard 0 runs every test; the others
// run only the shift guard's parts, which split the states between the shards.
const shardIndex = Number(/^(\d+)\/\d+$/.exec(process.env.JUNO_SHARD ?? '')?.[1] ?? 0)
// JUNO_SKIP_TAGS=@heavy-gallery skips the shift guard over every component, as the desktop config does for its tags.
const skipTags = (process.env.JUNO_SKIP_TAGS ?? '').split(',').filter(Boolean)

// GALLERY_WORKERS lets a machine of its own (bun run remote) run more. A run that walks only
// changed states spends its CPU starting workers and walk parts, so bun run remote gives it
// fewer (GALLERY_CACHED_WORKERS); GALLERY_SHIFT_ALL=1 walks every state with GALLERY_WORKERS.
const workers = Number((process.env.GALLERY_SHIFT_ALL === '1' ? undefined : process.env.GALLERY_CACHED_WORKERS) ?? process.env.GALLERY_WORKERS ?? (process.env.CI ? 2 : 3))
// The walks split their states into one part per worker.
process.env.GALLERY_SHIFT_PARTS ??= String(workers)

// The default Chromium headless shell is the same pinned browser locally and remotely.
// `bunx playwright install chromium --only-shell` installs it.
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  // Each worker loads the gallery once and its tests share that page, reset
  // between them (support.ts). The shift guard splits itself into parts to use the workers.
  workers,
  fullyParallel: true,
  retries: 0,
  reporter: [[process.env.CI ? 'github' : 'list'], ['json', { outputFile: 'playwright-report/results.json' }], ['../../scripts/test-results-reporter.mjs'], ['../../scripts/gallery-cpu-reporter.mjs']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.GALLERY_BROWSER === 'chrome' ? 'chrome' : undefined,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  },
  ...(shardIndex > 0 ? { grep: /no interaction shifts the layout, in any state of any component/ } : {}),
  ...(skipTags.length > 0 ? { grepInvert: new RegExp(skipTags.map((tag) => `${tag}\\b`).join('|')) } : {}),
  projects: [
    // Wide enough for the 240px switcher plus the widest frame (1400px).
    { name: 'shots', testMatch: 'shots.spec.ts', use: { viewport: { width: 1800, height: 1000 } } },
    // Every other spec, so a branch that adds one does not edit this line.
    { name: 'behaviour', testMatch: '*.spec.ts', testIgnore: ['shots.spec.ts', '**/node_modules/**'] },
  ],
  webServer: {
    command: `bun run vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})

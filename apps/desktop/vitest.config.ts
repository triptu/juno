import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each package keeps its own module cache. The default is one folder at the
    // repo root, which parallel `pnpm test` runs race on.
    fsModuleCachePath: fileURLToPath(new URL('./node_modules/.vitest-cache', import.meta.url)),
    // Several agents share one machine; keep each run small (see scripts/heavy.mjs).
    maxWorkers: 2,
    include: ['test/**/*.test.ts'],
    // The test boots a whole engine against the fake Slack, as the engine's own tests do.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
})

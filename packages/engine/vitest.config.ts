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
    // Engine tests boot a whole engine against an in-process fake Slack. On a
    // shared, loaded machine (load average 20 and up) a cold boot alone can take
    // tens of seconds, and boots in parallel files slow each other down, so the
    // files run one at a time and a test gets 90 s. The harness waits take at
    // most half of that, so a slow step fails with its own label, not a bare
    // timeout. A real hang still fails.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
})

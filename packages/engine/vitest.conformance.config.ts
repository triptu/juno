import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The conformance replays (test/conformance/README in test/README.md). Each
// trace boots its own engine and fake, so they run concurrently in one file.
export default defineConfig({
  test: {
    fsModuleCachePath: fileURLToPath(new URL('./node_modules/.vitest-cache', import.meta.url)),
    include: ['test/conformance/*.conformance.ts'],
    maxConcurrency: Number(process.env.JUNO_CONFORMANCE_CONCURRENCY ?? 6),
    maxWorkers: Number(process.env.JUNO_VITEST_WORKERS ?? 2),
    testTimeout: 600_000,
    hookTimeout: 90_000,
  },
})

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The conformance replays (test/conformance/README in test/README.md). Each
// trace boots its own engine and fake in the test's thread, so the traces are
// dealt to several files (`outbox-suite.ts`) that run in separate workers,
// and run concurrently within each file.
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

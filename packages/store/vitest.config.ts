import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each package keeps its own module cache. The default is one folder at the
    // repo root, which parallel `pnpm test` runs race on.
    fsModuleCachePath: fileURLToPath(new URL('./node_modules/.vitest-cache', import.meta.url)),
    // Several agents share one machine; keep each run small (see scripts/heavy.mjs).
    // A machine of its own (pnpm remote) sets JUNO_VITEST_WORKERS higher.
    maxWorkers: Number(process.env.JUNO_VITEST_WORKERS ?? 2),
    include: ['test/**/*.test.ts'],
    // Every test owns its temporary directory and SQLite handles. Remote workers
    // can overlap files; keep the shared Mac default unchanged.
    fileParallelism: process.env.JUNO_TEST_FILE_PARALLEL === '1',
  },
})

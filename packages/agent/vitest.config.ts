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
    projects: [
      {
        extends: true,
        test: {
          name: 'agent',
          include: ['test/**/*.test.ts', 'eval/**/*.test.ts'],
          exclude: ['test/**/*.bench.test.ts'],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'agent-timing',
          include: ['test/**/*.bench.test.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
    // Each test starts several agent processes.
    testTimeout: 120_000,
  },
})

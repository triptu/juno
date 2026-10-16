import { defineConfig } from '@playwright/test'

// Electron must not start as plain Node. Some shells export this; strip it
// here as well as in scripts/without-run-as-node.mjs.
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  testDir: 'e2e',
  // e2e/coverage.ts records which source files each spec runs, under JUNO_COVERAGE=1.
  globalSetup: ['./e2e/build.ts', './e2e/coverage.ts'],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // One Electron app at a time on the shared Mac. Each test has its own fake
  // Slack and user-data directory, so a machine of its own (pnpm remote) can
  // run more with JUNO_E2E_WORKERS.
  workers: Number(process.env.JUNO_E2E_WORKERS ?? 1),
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // Tests tagged @mac depend on macOS behaviour. pnpm remote runs on Linux and
  // skips them; every Mac run, including the scheduled full run, keeps them.
  grepInvert: process.platform === 'darwin' ? undefined : /@mac/,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
  },
})

import { defineConfig } from '@playwright/test'

// Electron must not start as plain Node. Some shells export this; strip it
// here as well as in scripts/without-run-as-node.mjs.
delete process.env.ELECTRON_RUN_AS_NODE

const excludedTags = [
  ...(process.platform === 'darwin' ? [] : ['@mac']),
  ...(process.env.JUNO_SKIP_TAGS ?? '').split(',').filter(Boolean),
]

export default defineConfig({
  testDir: 'e2e',
  projects: [
    { name: 'electron', testIgnore: 'web-shell.spec.ts' },
    {
      name: 'web',
      testMatch: 'web-shell.spec.ts',
      use: {
        channel: process.env.GALLERY_BROWSER === 'chromium' ? undefined : 'chrome',
        viewport: { width: 1280, height: 800 },
        reducedMotion: 'reduce',
      },
    },
  ],
  // e2e/coverage.ts records which source files each spec runs, under JUNO_COVERAGE=1.
  globalSetup: ['./e2e/build.ts', './e2e/coverage.ts'],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // One Electron app at a time on the shared Mac. Each test has its own fake
  // Slack and user-data directory, so a machine of its own (pnpm remote) can
  // run more with JUNO_E2E_WORKERS.
  workers: Number(process.env.JUNO_E2E_WORKERS ?? 1),
  fullyParallel: false,
  retries: process.env.CI || process.env.JUNO_REMOTE_CONTAINER ? 1 : 0,
  // Tests tagged @mac depend on macOS behaviour. pnpm remote runs on Linux and
  // skips them.
  grepInvert: excludedTags.length ? new RegExp(excludedTags.map((tag) => `${tag}\\b`).join('|')) : undefined,
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['../../scripts/test-results-reporter.mjs'],
    // Per-test timing lines for `node scripts/e2e-timings.mjs`.
    ...(process.env.JUNO_E2E_TIMINGS === '1' ? [['./e2e/timings.ts'] as const] : []),
  ],
  use: {
    trace: 'retain-on-failure',
  },
})

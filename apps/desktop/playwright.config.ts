import { defineConfig } from '@playwright/test'

// Electron must not start as plain Node. Some shells export this; strip it
// here as well as in scripts/without-run-as-node.mjs.
delete process.env.ELECTRON_RUN_AS_NODE

// JUNO_SKIP_TAGS=@heavy-sync,@heavy-idle skips those tags as well as @mac
// (below): pnpm affected sets it for the heavy areas a change does not reach
// (scripts/test-areas.mjs).
const skipTags = [...(process.platform === 'darwin' ? [] : ['@mac']), ...(process.env.JUNO_SKIP_TAGS ?? '').split(',').filter(Boolean)]

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
  grepInvert: skipTags.length === 0 ? undefined : new RegExp(skipTags.map((tag) => `${tag}\\b`).join('|')),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
  },
})

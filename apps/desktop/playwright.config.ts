import { defineConfig } from '@playwright/test'

// Electron must not start as plain Node. Some shells export this; strip it
// here as well as in scripts/without-run-as-node.mjs.
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // One Electron app at a time. Tests share the built app in out/.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
  },
})

import { defineConfig } from '@playwright/test'

// Electron must not start as plain Node; see playwright.config.ts.
delete process.env.ELECTRON_RUN_AS_NODE

/**
 * The feel suite (`pnpm test:feel`): scripted interactions recorded frame by
 * frame, with checks for shift, jumps, flicker, empty frames and late
 * feedback. Artefacts and the contact sheet go to `feel-report/`.
 */
export default defineConfig({
  testDir: 'e2e/feel',
  testMatch: '*.feel.ts',
  globalSetup: './e2e/feel/sheet.ts',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/feel',
  use: {
    trace: 'off',
  },
})

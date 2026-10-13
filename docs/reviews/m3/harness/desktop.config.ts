import { defineConfig } from '@playwright/test'

// The M3 design-review harness against the built desktop app and the fake
// Slack. Run from apps/desktop after `pnpm build`:
//   pnpm exec playwright test -c ../../docs/reviews/m3/harness/desktop.config.ts
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  testDir: '.',
  testMatch: 'review.spec.ts',
  timeout: 240_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: '/tmp/m3-review-results',
  use: { trace: 'off' },
})

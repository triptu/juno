import { defineConfig } from '@playwright/test'

// The 2026-10-15 design-review harness against the built desktop app, the
// fake Slack and the fake model. Run from apps/desktop after `pnpm build`:
//   REVIEW_SET=before node ../../scripts/heavy.mjs pnpm exec playwright test -c ../../docs/design/reviews/2026-10-15/harness/desktop.config.ts
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  testDir: '.',
  testMatch: 'review.spec.ts',
  timeout: 600_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: '/tmp/review-1015-results',
  use: { trace: 'off' },
})

import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * The perf suite (`pnpm perf`, `e2e/perf.spec.ts`). The e2e settings, plus a
 * reporter that fails the run when a scenario did not run (`e2e/no-skips.ts`).
 */
export default defineConfig({
  ...base,
  projects: [{ name: 'electron' }],
  testMatch: ['perf.spec.ts', '*.perf.spec.ts'],
  reporter: [['list'], ['./e2e/no-skips.ts']],
})

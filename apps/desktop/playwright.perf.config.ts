import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * The perf suite (`bun run perf`, `e2e/perf.spec.ts`). The e2e settings, the
 * Electron build first (cached, `e2e/build.ts`), and a reporter that fails the
 * run when a scenario did not run (`e2e/no-skips.ts`), and the structured
 * results a full run records (`scripts/test-results-reporter.mjs`).
 */
export default defineConfig({
  ...base,
  projects: [
    { name: 'build-electron', testMatch: 'setup/electron.setup.ts' },
    { name: 'electron', testMatch: ['perf.spec.ts', '*.perf.spec.ts'], dependencies: ['build-electron'] },
  ],
  reporter: [['list'], ['./e2e/no-skips.ts'], ['../../scripts/test-results-reporter.mjs']],
})

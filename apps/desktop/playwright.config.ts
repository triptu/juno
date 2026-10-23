import { cpus } from 'node:os'
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'
import type { Lane } from './e2e/fixtures'
import { BROWSER_SPECS } from './e2e/lanes'

// Electron must not start as plain Node. Some shells export this; strip it
// here as well as in scripts/without-run-as-node.mjs.
delete process.env.ELECTRON_RUN_AS_NODE

const excludedTags = [
  ...(process.platform === 'darwin' ? [] : ['@mac']),
  ...(process.env.JUNO_SKIP_TAGS ?? '').split(',').filter(Boolean),
]
const tagPattern = (tags: ReadonlyArray<string>) => tags.map((tag) => `${tag}\\b`).join('|')
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// One Electron app at a time on the shared Mac. Each test has its own fake
// Slack and user-data directory, so a machine of its own (bun run remote) can
// run more with JUNO_E2E_WORKERS.
const electronWorkers = Number(process.env.JUNO_E2E_WORKERS ?? 1)
// A browser test is a headless page and a small Node host: about half a core
// and 0.4 GB. Half the cores locally, where other agents share the Mac.
const browserWorkers = Number(process.env.JUNO_BROWSER_WORKERS ?? Math.max(2, Math.floor(cpus().length / 2)))

// The electron project runs its own files whole, and of the browser files
// only tests tagged @electron (they need main) or @canary (they run in both).
// A test's grep title starts with its project and its file relative to e2e/,
// space-separated, so one pattern selects both.
const electronGrep = new RegExp(`${tagPattern(['@electron', '@canary'])}|^(?!\\s*\\S+\\s(?:${BROWSER_SPECS.map(escape).join('|')})\\s)`)

export default defineConfig<object, { lane: Lane }>({
  testDir: 'e2e',
  projects: [
    { name: 'build-electron', testMatch: 'setup/electron.setup.ts' },
    { name: 'build-web', testMatch: 'setup/web.setup.ts' },
    {
      name: 'browser',
      testMatch: BROWSER_SPECS.map((file) => resolve(__dirname, 'e2e', file)),
      dependencies: ['build-web'],
      fullyParallel: true,
      workers: browserWorkers,
      grepInvert: new RegExp(tagPattern(['@electron', ...excludedTags])),
      use: {
        lane: 'web' satisfies Lane,
        browserName: 'chromium',
        // The Electron window's content size (src/main/window.ts).
        viewport: { width: 1200, height: 800 },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    {
      name: 'electron',
      testIgnore: ['web/web-shell.spec.ts', 'setup/**'],
      dependencies: ['build-electron'],
      workers: electronWorkers,
      grep: electronGrep,
      ...(excludedTags.length ? { grepInvert: new RegExp(tagPattern(excludedTags)) } : {}),
    },
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
  globalSetup: ['./e2e/coverage.ts'],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: Math.max(electronWorkers, browserWorkers),
  fullyParallel: false,
  retries: process.env.CI || process.env.JUNO_REMOTE_CONTAINER ? 1 : 0,
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['../../scripts/test-results-reporter.mjs'],
    // Per-test timing lines for `bun scripts/e2e-timings.mjs`.
    ...(process.env.JUNO_E2E_TIMINGS === '1' ? [['./e2e/timings.ts'] as const] : []),
  ],
  use: {
    // JUNO_E2E_TRACE=off skips recording, to measure what tracing costs.
    trace: process.env.JUNO_E2E_TRACE === 'off' ? 'off' : 'retain-on-failure',
  },
})

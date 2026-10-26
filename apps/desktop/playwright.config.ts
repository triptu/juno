import { cpus } from 'node:os'
import { join, resolve } from 'node:path'
import { defineConfig } from '@playwright/test'
import type { Lane } from './e2e/fixtures'
import { BROWSER_SPECS } from './e2e/lanes'

// `@on-demand` tests (the feel scenarios outside the six of every full run, the idle walk) run only with JUNO_ON_DEMAND=1.
const excludedTags = [
  ...(process.platform === 'darwin' ? [] : ['@mac']),
  ...(process.env.JUNO_ON_DEMAND === '1' ? [] : ['@on-demand']),
  ...(process.env.JUNO_SKIP_TAGS ?? '').split(',').filter(Boolean),
]
const tagPattern = (tags: ReadonlyArray<string>) => tags.map((tag) => `${tag}\\b`).join('|')
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Every lane runs in one time zone and locale, whatever the machine's (UTC on the runner, IST on the Mac): the
// workers, the browser, Electron and the engine host inherit TZ; the browser's contexts (`browser/pages.ts`) and
// Electron (`launch.ts`) are pinned to en-US.
process.env.TZ = 'UTC'
// A stress run (JUNO_STRESS, scripts/remote/workers.sh) slows everything down and scales the default timeouts to match.
const scale = Number(process.env.JUNO_STRESS_SCALE ?? 1)

// One Electron app at a time on the shared Mac. Each test has its own fake
// Slack and user-data directory, so a machine of its own (bun run remote) can
// run more with JUNO_E2E_WORKERS.
const electronWorkers = Number(process.env.JUNO_E2E_WORKERS ?? 1)
// Loaded hosts and cached assets let one browser worker per allocated thread
// keep the job busy. A container sees every core of its host, so use the
// allocation rather than the host's count. Local full verification caps this.
const allocatedThreads = Number(process.env.JUNO_RUNNER_JOB_CORES)
// Five workers on eight threads: on a four-core job, eight used 11% more CPU per test (hyperthreads share cores) and
// finished later; four left threads idle (README, "Browser lane").
const browserWorkers = Number(process.env.JUNO_BROWSER_WORKERS ?? Math.max(1, Math.round((allocatedThreads || Math.floor(cpus().length / 2)) * 5 / 8)))

// The electron project runs its own files whole, and of the browser files
// only tests tagged @electron (they need main) or @canary (they run in both).
// A test's grep title starts with its project and its file relative to e2e/,
// space-separated, so one pattern selects both.
const electronGrep = new RegExp(`${tagPattern(['@electron', '@canary'])}|^(?!\\s*\\S+\\s(?:${BROWSER_SPECS.map(escape).join('|')})\\s)`)

// Each project, and each step of a `test:plan` run (JUNO_PLAN_STEP), writes its
// own folder, so one step does not empty another's traces and results.
const results = join(__dirname, 'test-results', process.env.JUNO_PLAN_STEP === undefined ? '' : `step-${process.env.JUNO_PLAN_STEP}`)

// The feel scenarios (e2e/feel) run in the browser beside the other specs, on
// a machine other jobs share: their contact sheet goes with the test results,
// only failed scenarios keep frames, filmstrip and video, and a long animation
// frame only warns (`bun run perf` owns timing). `bun run test:feel` keeps the
// full record in Electron on the Mac.
process.env.JUNO_FEEL_REPORT ??= join(results, 'feel-report')
process.env.JUNO_FEEL_MEDIA ??= 'failed'
process.env.JUNO_FEEL_LONG_FRAMES ??= 'warn'

export default defineConfig<object, { lane: Lane }>({
  testDir: 'e2e',
  // The build steps' folder; a project's own replaces it.
  outputDir: join(results, 'setup'),
  projects: [
    { name: 'build-electron', testMatch: 'setup/electron.setup.ts' },
    { name: 'build-web', testMatch: 'setup/web.setup.ts' },
    // Before the browser project, so its long scenarios start first rather than hold the run open at its end (e2e/order.ts).
    {
      name: 'feel',
      testDir: 'e2e/feel',
      testMatch: '*.feel.ts',
      outputDir: join(results, 'feel'),
      dependencies: ['build-web'],
      fullyParallel: true,
      retries: 0,
      // Each scenario films and analyses every frame; half the browser workers keep the frames coming on time.
      workers: Math.max(1, Math.ceil(browserWorkers / 2)),
      timeout: 120_000 * scale,
      expect: { timeout: 15_000 * scale },
      ...(excludedTags.length ? { grepInvert: new RegExp(tagPattern(excludedTags)) } : {}),
      use: {
        lane: 'web' satisfies Lane,
        browserName: 'chromium',
        launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
        viewport: { width: 1200, height: 800 },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    {
      name: 'browser',
      outputDir: join(results, 'browser'),
      testMatch: BROWSER_SPECS.map((file) => resolve(__dirname, 'e2e', file)),
      dependencies: ['build-web'],
      fullyParallel: true,
      // A test that passes only on a second try is a bug to fix.
      retries: 0,
      workers: browserWorkers,
      grepInvert: new RegExp(tagPattern(['@electron', ...excludedTags])),
      use: {
        lane: 'web' satisfies Lane,
        browserName: 'chromium',
        launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
        // The Electron window's content size (src/main/window.ts).
        viewport: { width: 1200, height: 800 },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    {
      name: 'electron',
      outputDir: join(results, 'electron'),
      testIgnore: ['web/web-shell.spec.ts', 'setup/**', 'perf.spec.ts', '*.perf.spec.ts', ...(process.env.JUNO_SCREENS === '1' ? [] : ['screens.spec.ts', '**/screens/**'])],
      dependencies: ['build-electron'],
      // Each test is its own group, so one file's tests spread over the workers; the slowest start first (e2e/order.ts).
      fullyParallel: true,
      workers: electronWorkers,
      grep: electronGrep,
      ...(excludedTags.length ? { grepInvert: new RegExp(tagPattern(excludedTags)) } : {}),
    },
    {
      name: 'web',
      outputDir: join(results, 'web'),
      testMatch: 'web-shell.spec.ts',
      use: {
        channel: process.env.GALLERY_BROWSER === 'chromium' ? undefined : 'chrome',
        viewport: { width: 1280, height: 800 },
        reducedMotion: 'reduce',
      },
    },
  ],
  globalSetup: './e2e/feel/sheet.ts',
  timeout: 30_000 * scale,
  expect: { timeout: 5_000 * scale },
  workers: Math.max(electronWorkers, browserWorkers),
  fullyParallel: false,
  retries: 0,
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['../../scripts/test-results-reporter.mjs'],
    ['json', { outputFile: join(results, 'results.json') }],
    ['./e2e/order.ts'],
    // Per-test timing lines for `bun scripts/e2e-timings.mjs`.
    ...(process.env.JUNO_E2E_TIMINGS === '1' ? [['./e2e/timings.ts'] as const] : []),
  ],
  use: {
    // Recording a trace costs about a fifth of a test's time. Rerun a failure
    // with JUNO_E2E_TRACE=1 to keep a trace of each failing test.
    trace: process.env.JUNO_E2E_TRACE === '1' ? 'retain-on-failure' : 'off',
  },
})

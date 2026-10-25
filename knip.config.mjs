export default {
  include: ['files', 'exports', 'nsExports', 'types', 'nsTypes', 'dependencies', 'unlisted'],
  includeEntryExports: true,
  // A symbol used in its own module is live code. Report it when that use goes away.
  ignoreExportsUsedInFile: true,
  ignoreIssues: {
    // Knip loads this configuration's default export itself.
    'knip.config.mjs': ['exports'],
    // Playwright loads this opt-in reporter by its file name.
    'apps/desktop/e2e/timings.ts': ['exports'],
    'scripts/test-results-reporter.mjs': ['exports'],
    // This module asserts wire compatibility at compile time.
    'packages/engine/src/messages/body.ts': ['exports', 'types'],
    // createRequire is rooted at apps/desktop/package.json, which declares Playwright.
    'scripts/build-icons.mjs': ['unlisted'],
  },
  workspaces: {
    '.': {
      entry: ['scripts/*.{mjs,ts}', 'specs/check.mjs', 'specs/conformance.mjs', 'knip.config.mjs'],
      project: ['scripts/**/*.{mjs,ts}', 'specs/**/*.mjs'],
    },
    // Knip reads every package.json exports map; bun test's *.test.ts files are entries
    // by default. Package scripts also cover the AI eval entries.
    'packages/*': { project: ['**/*.{ts,tsx}'] },
    // Bun's test runner finds *.test.ts; the perf and conformance files are run by path (scripts/perf.mjs, specs/conformance.mjs).
    'packages/engine': { entry: ['src/messages/body.ts', 'test/**/*.test.ts', 'test/perf/*.perf.ts', 'test/conformance/*.conformance.ts'], project: ['**/*.{ts,tsx}'] },
    // scripts/perf.mjs runs the agent's *.perf.ts files, which bun test's default pattern skips.
    'packages/agent': { entry: ['eval/run.ts', 'bench/*.ts', 'test/**/*.perf.ts'], project: ['**/*.{ts,tsx}'] },
    'docs/juno-agent/spikes': { entry: ['*.ts'], project: ['*.ts'] },
    'packages/tokens': {
      project: ['**/*.{ts,tsx}'],
      // Vite loads these CSS @imports from src/fonts.css; Knip does not parse CSS.
      ignoreDependencies: ['@fontsource-variable/figtree', '@fontsource/instrument-serif', '@fontsource/jetbrains-mono'],
    },
    'apps/desktop': {
      entry: [
        'build/*.cjs',
        'e2e/timings.ts', // Loaded only when JUNO_E2E_TIMINGS enables the reporter.
        'src/main/index.ts',
        'src/engine/index.ts',
        'src/preload/index.ts',
        'src/renderer/index.html',
        // The web shell (`bun run web`): its host and the page entry it serves.
        'web/host/cli.ts',
        'web/page/main.ts',
        // The DOM lane's bun test files (scripts/dom-tests.mjs).
        'dom/**/*.test.ts',
      ],
      project: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts', 'dom/**/*.ts', 'packaging/**/*.ts', 'build/*.cjs', 'web/**/*.ts', '*.config.ts', '*.vite.ts'],
      playwright: { config: ['playwright*.config.ts'] },
      vite: { config: ['electron.vite.config.ts', 'vite.web.config.ts', 'dom/vite.config.ts'] },
    },
    'apps/gallery': {
      entry: ['index.html'],
      project: ['src/**/*.{ts,tsx}', '*.ts'],
    },
  },
}

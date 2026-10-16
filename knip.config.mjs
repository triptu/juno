export default {
  include: ['files', 'exports', 'nsExports', 'types', 'nsTypes', 'dependencies', 'unlisted'],
  includeEntryExports: true,
  // A symbol used in its own module is live code. Report it when that use goes away.
  ignoreExportsUsedInFile: true,
  ignoreIssues: {
    // Knip loads this configuration's default export itself.
    'knip.config.mjs': ['exports'],
    // This module asserts wire compatibility at compile time.
    'packages/engine/src/messages/body.ts': ['exports', 'types'],
    // createRequire is rooted at apps/desktop/package.json, which declares Playwright.
    'scripts/build-icons.mjs': ['unlisted'],
  },
  workspaces: {
    '.': {
      entry: ['scripts/*.{mjs,ts}', 'specs/check.mjs', 'specs/conformance.mjs', 'knip.config.mjs'],
      project: ['scripts/**/*.{mjs,ts}', 'specs/**/*.mjs'],
      // typecheck-bun resolves the pinned executable through bun/package.json;
      // scripts/lint.mjs starts oxlint from node_modules/.bin.
      ignoreDependencies: ['bun', 'oxlint'],
    },
    // Knip reads every package.json exports map and discovers test/config entries
    // through its Vitest plugin. Package scripts also cover the AI eval entries.
    'packages/*': { project: ['**/*.{ts,tsx}'] },
    'packages/engine': { entry: ['src/messages/body.ts'], project: ['**/*.{ts,tsx}'], vitest: { config: ['vitest.config.ts', 'vitest.conformance.config.ts'] } },
    'packages/agent': { entry: ['eval/run.ts', 'bench/*.ts'], project: ['**/*.{ts,tsx}'] },
    'docs/juno-agent/spikes': { entry: ['*.ts'], project: ['*.ts'] },
    'packages/tokens': {
      project: ['**/*.{ts,tsx}'],
      // Vite loads these CSS @imports from src/fonts.css; Knip does not parse CSS.
      ignoreDependencies: ['@fontsource-variable/figtree', '@fontsource/instrument-serif', '@fontsource/jetbrains-mono'],
    },
    'apps/desktop': {
      entry: [
        'build/*.cjs',
        'src/main/index.ts',
        'src/engine/index.ts',
        'src/preload/index.ts',
        'src/renderer/index.html',
      ],
      project: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts', 'packaging/**/*.ts', 'build/*.cjs', '*.config.ts'],
      playwright: { config: ['playwright*.config.ts'] },
      vite: { config: ['electron.vite.config.ts'] },
      // Babel loads the shared reactCompiler tuple by its string name in the Vite config.
      ignoreDependencies: ['babel-plugin-react-compiler'],
    },
    'apps/gallery': {
      entry: ['index.html'],
      project: ['src/**/*.{ts,tsx}', '*.ts'],
      // Babel loads the shared reactCompiler tuple by its string name in the Vite config.
      ignoreDependencies: ['babel-plugin-react-compiler'],
    },
  },
}

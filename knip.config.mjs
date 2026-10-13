export default {
  include: ['files', 'exports', 'nsExports', 'types', 'nsTypes', 'dependencies', 'unlisted'],
  includeEntryExports: true,
  // A symbol used in its own module is live code. Report it when that use goes away.
  ignoreExportsUsedInFile: true,
  ignoreIssues: {
    // Knip loads this configuration's default export itself.
    'knip.config.mjs': ['exports'],
    // createRequire is rooted at apps/desktop/package.json, which declares Playwright.
    'scripts/build-icons.mjs': ['unlisted'],
  },
  workspaces: {
    '.': {
      entry: ['scripts/*.{mjs,ts}', 'specs/check.mjs', 'knip.config.mjs'],
      project: ['scripts/**/*.{mjs,ts}', 'specs/**/*.mjs'],
    },
    // Knip reads every package.json exports map and discovers test/config entries
    // through its Vitest plugin. Package scripts also cover the AI eval entries.
    'packages/*': { project: ['**/*.{ts,tsx}'] },
    'packages/tokens': {
      project: ['**/*.{ts,tsx}'],
      // Vite loads these CSS @imports from src/fonts.css; Knip does not parse CSS.
      ignoreDependencies: ['@fontsource-variable/figtree', '@fontsource/instrument-serif', '@fontsource/jetbrains-mono'],
    },
    'apps/desktop': {
      entry: [
        'src/main/index.ts',
        'src/engine/index.ts',
        'src/preload/index.ts',
        'src/renderer/index.html',
      ],
      project: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts', '*.config.ts'],
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

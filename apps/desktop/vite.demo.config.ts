/**
 * The read-only demo (`docs/development.md`, "Demo"): the renderer built
 * for a browser with the demo's page entry (`web/demo/page/main.ts`) in
 * place of `main.tsx`, into `web/demo/dist/`, which `scripts/demo-build.mjs`
 * then fills with the snapshot. Same renderer plugins and output as the
 * Electron build (`renderer.vite.ts`), minified the same way.
 *
 * `base` is relative, so the folder works under any path (`/try/`).
 * Served by `vite -c vite.demo.config.ts` for UI work, it reads the last
 * export from `web/demo/dist/demo/`.
 */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { rendererOutput, rendererPlugins } from './renderer.vite'

const repoRoot = resolve(__dirname, '../..')
const DEMO_DIST = resolve(__dirname, 'web/demo/dist')
// Bun's global store, where packages such as the fonts really live (`globalStore` in bunfig.toml).
const store = realpathSync(resolve(__dirname, 'node_modules/react')).replace(/\/links\/.*$/, '/links')

const pageEntry = resolve(__dirname, 'web/demo/page/main.ts')

/** The demo's page entry in place of `main.tsx`; the dev server reaches it outside its root through `/@fs`. */
function demoEntry(command: 'build' | 'serve'): Plugin {
  return {
    name: 'juno:demo-entry',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('src="./main.tsx"', command === 'build' ? 'src="../../web/demo/page/main.ts"' : `src="/@fs${pageEntry}"`),
    },
  }
}

export default defineConfig(({ command }) => ({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  ...(command === 'serve' ? { publicDir: DEMO_DIST, server: { fs: { allow: [repoRoot, store] } } } : {}),
  build: {
    outDir: DEMO_DIST,
    emptyOutDir: true,
    minify: 'oxc',
    reportCompressedSize: false,
    rolldownOptions: { input: resolve(__dirname, 'src/renderer/index.html'), output: rendererOutput },
  },
  logLevel: 'warn',
  plugins: [demoEntry(command), ...rendererPlugins({ repoRoot, minify: command === 'build', reportSkipped: false })],
}))

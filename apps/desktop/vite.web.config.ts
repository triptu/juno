/**
 * The renderer built for a browser, with the web page entry (`web/page/main.ts`)
 * in place of `main.tsx`, into `dist/`. The browser e2e lane serves it from
 * each test's host (`web/host/testHost.ts`); `bun run web` keeps Vite's dev
 * server instead. Built once per run through `build-cached`, like `out/`.
 *
 * It uses the same renderer plugins as the Electron build (`renderer.vite.ts`)
 * and is minified the same way, so the browser runs the code Electron runs. It
 * has no Content Security Policy: the host serves fake Slack's files on the
 * page's own origin under `/__juno/`.
 */
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { rendererPlugins } from './renderer.vite'

const repoRoot = resolve(__dirname, '../..')

function webEntry(): Plugin {
  return {
    name: 'juno:web-entry',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('src="./main.tsx"', 'src="../../web/page/main.ts"'),
    },
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: '/',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: process.env['JUNO_COVERAGE'] === '1' ? 'hidden' : false,
    reportCompressedSize: false,
    rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
  },
  logLevel: 'warn',
  plugins: [webEntry(), ...rendererPlugins({ repoRoot, minify: true, reportSkipped: false })],
})

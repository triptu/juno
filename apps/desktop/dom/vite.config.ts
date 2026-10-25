/**
 * The DOM lane's renderer (README): the web page entry (`web/page/main.ts`)
 * as one classic script that each test runs in a new happy-dom window. The
 * browser lane's renderer plugins, except that StyleX writes plain rules,
 * since happy-dom's cascade skips rules inside `@layer`. Production React,
 * unminified so a stack names functions. Built with the host into
 * `dom/dist/` through `build-cached` (`test:dom`).
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { rendererPlugins } from '../renderer.vite'

const repoRoot = resolve(__dirname, '../../..')

export default defineConfig({
  root: __dirname,
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    reportCompressedSize: false,
    cssCodeSplit: false,
    lib: { entry: resolve(__dirname, '../web/page/main.ts'), formats: ['iife'], name: 'junoRenderer', fileName: () => 'renderer.js', cssFileName: 'style' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  plugins: rendererPlugins({ repoRoot, minify: false, reportSkipped: false, cssLayers: false }),
})

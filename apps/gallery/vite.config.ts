import { resolve } from 'node:path'
import stylex from '@stylexjs/unplugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The monorepo root, so StyleX resolves the workspace token package the same
// way the desktop renderer does (see apps/desktop/electron.vite.config.ts).
const repoRoot = resolve(__dirname, '../..')

export default defineConfig({
  root: __dirname,
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    fs: { allow: [repoRoot] },
  },
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot },
    }),
    react(),
  ],
})

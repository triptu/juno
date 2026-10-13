import { resolve } from 'node:path'
import stylex from '@stylexjs/unplugin'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The monorepo root, so StyleX resolves the workspace token package the same
// way the desktop renderer does (see apps/desktop/electron.vite.config.ts).
const repoRoot = resolve(__dirname, '../..')

/**
 * Holds `/__fixture/pending.png` open and never answers. The Avatar `pending`
 * state points at it, so a photo that has not arrived stays that way for as
 * long as someone looks, with no timer. Tests intercept the request and
 * answer it when they want the photo to land.
 */
function pendingImage(): Plugin {
  const hold = (server: { middlewares: { use: (path: string, handler: () => void) => void } }) => {
    server.middlewares.use('/__fixture/pending.png', () => {})
  }
  return { name: 'gallery-pending-image', configureServer: hold, configurePreviewServer: hold }
}

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
    pendingImage(),
    stylex.vite({
      useCSSLayers: true,
      unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot },
    }),
    react(),
  ],
})

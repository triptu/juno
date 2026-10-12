import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import stylex from '@stylexjs/unplugin'

/**
 * Injects the renderer's Content Security Policy. Production allows only
 * bundled scripts. Dev additionally allows the inline React Refresh preamble
 * and the HMR websocket.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'juno:csp',
    transformIndexHtml(_html, context) {
      const dev = Boolean(context.server)
      const policy = [
        "default-src 'self'",
        dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data:",
        dev ? "connect-src 'self' ws://localhost:*" : "connect-src 'self'",
      ].join('; ')
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

// The monorepo root. StyleX hashes class names relative to this directory and
// needs it to resolve the workspace token package, no matter which directory
// the build is started from.
const repoRoot = resolve(__dirname, '../..')

// Workspace packages ship TypeScript source, so main and preload must bundle
// them. Everything else from node_modules stays external.
const externalize = externalizeDepsPlugin({ exclude: ['@juno/contract'] })

export default defineConfig({
  main: {
    plugins: [externalize],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalize],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
    plugins: [
      contentSecurityPolicy(),
      stylex.vite({
        useCSSLayers: true,
        unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot },
      }),
      react(),
    ],
  },
})

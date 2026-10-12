import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import stylex from '@stylexjs/unplugin'

/**
 * Injects the renderer's Content Security Policy (architecture section 14).
 * Production allows only bundled code and styles; images may come from the
 * juno: scheme, Slack's CDN and Gravatar. Dev additionally allows the inline
 * React Refresh preamble, Vite's injected styles and the HMR websocket.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'juno:csp',
    transformIndexHtml(_html, context) {
      const dev = Boolean(context.server)
      const policy = [
        "default-src 'self'",
        dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
        "font-src 'self'",
        "img-src 'self' juno: https://*.slack-edge.com https://secure.gravatar.com data:",
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

// Workspace packages ship TypeScript source, so main, preload and the engine
// entry must bundle them. `effect` is bundled too: externalised, main loaded
// the whole barrel through require("effect") before creating the window.
// Measured on the M1 shell (7 runs, median): launch to first window 416 ms
// external vs 314 ms bundled; launch to "Engine live" 526 ms vs 379 ms.
// Everything else from node_modules stays external.
const externalize = externalizeDepsPlugin({ exclude: ['@juno/contract', '@juno/engine', '@juno/state', 'effect'] })

// electron-vite defaults every target to `minify: false`. Minified output is
// less than half the size and parses faster; scripts/check-bundle-size.mjs
// holds the renderer to the budget in docs/performance.md.
const minify = 'esbuild' as const

export default defineConfig({
  main: {
    plugins: [externalize],
    build: {
      minify,
      rollupOptions: {
        // index.js is the main process; engine.js is forked as a utility process.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          engine: resolve(__dirname, 'src/engine/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalize],
    build: {
      minify,
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      minify,
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

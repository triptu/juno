import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire, isBuiltin } from 'node:module'
import { dependencies } from './package.json'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import { rendererOutput, rendererPlugins } from './renderer.vite'

/**
 * Injects the renderer's Content Security Policy (architecture section 14).
 * Production allows only bundled code and styles; images may come from the
 * juno: scheme, Slack's CDN and Gravatar. The media viewer plays audio and
 * video, frames a PDF or HTML file and reads a text file from the juno:
 * scheme (main's `juno://files`). A huddle's media session talks to
 * Chime (`*.chime.aws`: the nearest region, signalling and its event
 * ingest), and Chime's Voice Focus loads its scripts, workers and wasm from
 * `*.sdkassets.chime.aws` (packages/huddle-media/README.md). Dev
 * additionally allows the inline React Refresh preamble, Vite's injected
 * styles and the HMR websocket.
 */
const CHIME = 'https://*.chime.aws wss://*.chime.aws'
const VOICE_FOCUS = 'https://*.sdkassets.chime.aws'

function contentSecurityPolicy(): Plugin {
  return {
    name: 'juno:csp',
    transformIndexHtml(_html, context) {
      const dev = Boolean(context.server)
      const policy = [
        "default-src 'self'",
        `script-src 'self'${dev ? " 'unsafe-inline'" : ''} 'wasm-unsafe-eval' blob: ${VOICE_FOCUS}`,
        `worker-src 'self' blob: ${VOICE_FOCUS}`,
        dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
        "font-src 'self'",
        "img-src 'self' juno: https://*.slack-edge.com https://secure.gravatar.com data:",
        "media-src 'self' juno:",
        "frame-src juno:",
        `connect-src 'self' juno:${dev ? ' ws://localhost:*' : ''} ${CHIME}`,
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

/**
 * Preloads the fonts the first screen uses (performance.md 2.3): Figtree for
 * the shell and the sidebar, Instrument Serif for Home's greeting. Without
 * it the font is only requested once the first layout finds it, and when it
 * arrives the whole page is laid out again. The build fails if a file is
 * not in the bundle, so a renamed font cannot drop the preload quietly.
 */
function preloadFonts(patterns: ReadonlyArray<RegExp>): Plugin {
  return {
    name: 'juno:preload-fonts',
    apply: 'build',
    transformIndexHtml(_html, context) {
      const files = Object.keys(context.bundle ?? {})
      return patterns.map((pattern) => {
        const file = files.find((name) => pattern.test(name))
        if (file === undefined) throw new Error(`juno:preload-fonts: no bundled font matches ${pattern}`)
        return { tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: `./${file}` }, injectTo: 'head' as const }
      })
    },
  }
}

// The monorepo root, for the renderer plugins (renderer.vite.ts).
const repoRoot = resolve(__dirname, '../..')

// Build-time dependencies are bundled. Only production dependencies in the desktop manifest
// remain external and are copied by electron-builder. Keep that boundary checked.
const workspaceRuntime = Object.keys(dependencies).filter((name) => name.startsWith('@juno/'))
if (workspaceRuntime.length > 0) throw new Error(`Workspace packages must be build-time dependencies: ${workspaceRuntime.join(', ')}`)
const externalize = externalizeDepsPlugin()
function runtimeImports(): Plugin {
  return {
    name: 'juno:runtime-imports',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue
        for (const spec of [...file.imports, ...file.dynamicImports]) {
          if (spec in bundle || spec.startsWith('.') || spec === 'electron' || isBuiltin(spec)) continue
          const name = spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')
          if (!(name in dependencies)) this.error(`Unpackaged runtime dependency: ${spec}`)
        }
      }
    },
  }
}

/**
 * Writes the codemode sandbox's QuickJS binary next to agent.js. pi-codemode
 * finds it in node_modules, which a packaged app does not have, so the agent
 * passes this path instead (`src/agent/index.ts`). The worker is its own
 * input, `codemode-worker`.
 */
function codemodeFiles(): Plugin {
  // pi-codemode exports ESM only, so it is found by its folder, where Bun links it for the agent.
  const fromCodemode = createRequire(realpathSync(resolve(__dirname, '../../packages/agent/node_modules/@earendil-works/pi-codemode/package.json')))
  return {
    name: 'juno:codemode-files',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'quickjs.wasm', source: readFileSync(fromCodemode.resolve('quickjs-wasi/quickjs.wasm')) })
    },
  }
}

// electron-vite defaults every target to `minify: false`. Minified output is
// less than half the size and parses faster; scripts/check-bundle-size.mjs
// holds the renderer to the budget in docs/performance.md.
// JUNO_UNMINIFIED=1 keeps function names for a CPU profile (scripts/perf-trace.mjs).
const minify = process.env['JUNO_UNMINIFIED'] === '1' ? false : ('oxc' as const)

// JUNO_COVERAGE=1 writes source maps beside the bundles, without a comment in
// them, so scripts/coverage-map.mjs can map what an e2e test ran back to the
// source files (docs/development.md, "Affected tests").
const sourcemap = process.env['JUNO_COVERAGE'] === '1' ? ('hidden' as const) : false

// scripts/build-desktop.mjs builds main and preload in one process and the
// renderer in another, at the same time; JUNO_ELECTRON_TARGETS names the
// targets this process builds. Unset, it builds all three.
const targets = process.env['JUNO_ELECTRON_TARGETS']?.split(',')
const only = <T>(name: string, config: T): T | undefined => (targets === undefined || targets.includes(name) ? config : undefined)

export default defineConfig({
  main: only('main', {
    plugins: [externalize, runtimeImports(), codemodeFiles()],
    // `ws` loads the optional native `bufferutil` in a try. Bundled, that require
    // becomes an empty stub, so masking a frame of 48 bytes or more threw
    // "mask is not a function". This keeps `ws` on its own JavaScript masking.
    define: { 'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('1') },
    build: {
      minify,
      sourcemap,
      rolldownOptions: {
        // index.js is the main process; engine.js and agent.js are forked as utility processes;
        // codemode-worker.js is the agent's codemode sandbox thread.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          engine: resolve(__dirname, 'src/engine/index.ts'),
          agent: resolve(__dirname, 'src/agent/index.ts'),
          'codemode-worker': resolve(__dirname, 'src/agent/codemode-worker.ts'),
        },
      },
    },
  }),
  preload: only('preload', {
    plugins: [externalize, runtimeImports()],
    build: {
      minify,
      sourcemap,
      rolldownOptions: { input: resolve(__dirname, 'src/preload/index.ts') },
    },
  }),
  renderer: only('renderer', {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      minify,
      sourcemap,
      rolldownOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        output: rendererOutput,
      },
    },
    plugins: [
      contentSecurityPolicy(),
      preloadFonts([/figtree-latin-wght-normal-[^/]*\.woff2$/, /instrument-serif-latin-400-normal-[^/]*\.woff2$/]),
      ...rendererPlugins({ repoRoot, minify: minify !== false }),
    ],
  }),
})

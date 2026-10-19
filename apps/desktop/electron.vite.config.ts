import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire, isBuiltin } from 'node:module'
import { dependencies } from './package.json'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import stylex from '@stylexjs/unplugin'

/**
 * Injects the renderer's Content Security Policy (architecture section 14).
 * Production allows only bundled code and styles; images may come from the
 * juno: scheme, Slack's CDN and Gravatar. A huddle's media session talks to
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
        `connect-src 'self'${dev ? ' ws://localhost:*' : ''} ${CHIME}`,
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

// The icon weights Juno draws: `IconWeight` in packages/ui/src/Icon.tsx. Keep the two lists the same.
const ICON_WEIGHTS = new Set(['regular', 'bold', 'fill'])

// The icons that draw duotone: the ones packages/ui/src/duotone.ts imports, the only way to draw it.
const DUOTONE_ICONS = new Set(
  Array.from(readFileSync(resolve(__dirname, '../../packages/ui/src/duotone.ts'), 'utf8').matchAll(/@phosphor-icons\/react\/dist\/icons\/([A-Za-z0-9]+)'/g), (match) => match[1]),
)
if (!DUOTONE_ICONS.has('Sparkle')) throw new Error('juno:phosphor-weights: found no duotone icons in packages/ui/src/duotone.ts')

/**
 * Drops the icon weights Juno never draws from each Phosphor icon module:
 * thin and light everywhere, and duotone from every icon `duotone.ts` does
 * not import. Every icon ships all six weights as one `Map` built when the
 * module loads, so tree shaking cannot remove the unused ones. Thin and
 * light were about a third of the icons' share of the first bundle
 * (10-15), duotone about 40 KB more (10-17).
 */
function phosphorWeights(): Plugin {
  const defs = /@phosphor-icons\/react\/dist\/defs\/([A-Za-z0-9]+)\.es\.js$/
  return {
    name: 'juno:phosphor-weights',
    enforce: 'pre',
    transform(code, id) {
      const icon = defs.exec(id)?.[1]
      if (icon === undefined) return undefined
      let out = code
      for (const weight of ['thin', 'light', 'duotone']) {
        if (ICON_WEIGHTS.has(weight) || (weight === 'duotone' && DUOTONE_ICONS.has(icon))) continue
        const start = out.search(new RegExp(`\\[\\s*"${weight}",`))
        if (start < 0) continue
        // The entry ends at the bracket that closes it; path data holds no brackets or quotes.
        let depth = 0
        let end = start
        for (; end < out.length; end++) {
          const char = out[end]
          if (char === '[' || char === '(' || char === '{') depth++
          else if (char === ']' || char === ')' || char === '}') depth--
          if (depth === 0) break
        }
        const comma = /^\s*,/.exec(out.slice(end + 1))
        out = out.slice(0, start) + out.slice(end + 1 + (comma?.[0].length ?? 0))
      }
      return { code: out, map: null }
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

// The monorepo root. StyleX hashes class names relative to this directory and
// needs it to resolve the workspace token package, no matter which directory
// the build is started from.
const repoRoot = resolve(__dirname, '../..')

// Build-time dependencies are bundled. Only dependencies in the desktop manifest
// remain external and are copied by electron-builder. Keep that boundary checked.
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
  // pi-codemode exports ESM only, so it is found by its folder, where pnpm links it for the agent.
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
const minify = process.env['JUNO_UNMINIFIED'] === '1' ? false : ('esbuild' as const)

// JUNO_COVERAGE=1 writes source maps beside the bundles, without a comment in
// them, so scripts/coverage-map.mjs can map what an e2e test ran back to the
// source files (docs/development.md, "Affected tests").
const sourcemap = process.env['JUNO_COVERAGE'] === '1' ? ('hidden' as const) : false

// The React Compiler memoizes components and hooks at build time
// (performance.md 5.4). It runs as a Babel plugin inside plugin-react 5, on
// the workspace packages' source too. A component it cannot compile is left
// as written; the build prints which one and why.
const reactCompiler = [
  'babel-plugin-react-compiler',
  {
    target: '19',
    logger: {
      logEvent(filename: string | null, event: { kind: string; detail?: { reason?: string } }) {
        if (event.kind === 'CompileError' || event.kind === 'PipelineError') console.warn(`react-compiler: skipped a function in ${filename}: ${event.detail?.reason ?? event.kind}`)
      },
    },
  },
] as const

export default defineConfig({
  main: {
    plugins: [externalize, runtimeImports(), codemodeFiles()],
    build: {
      minify,
      sourcemap,
      rollupOptions: {
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
  },
  preload: {
    plugins: [externalize, runtimeImports()],
    build: {
      minify,
      sourcemap,
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      minify,
      sourcemap,
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
    plugins: [
      contentSecurityPolicy(),
      phosphorWeights(),
      preloadFonts([/figtree-latin-wght-normal-[^/]*\.woff2$/, /instrument-serif-latin-400-normal-[^/]*\.woff2$/]),
      stylex.vite({
        useCSSLayers: true,
        unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot },
      }),
      react({ babel: { plugins: [reactCompiler] } }),
    ],
  },
})

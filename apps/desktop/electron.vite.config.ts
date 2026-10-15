import { resolve } from 'node:path'
import { isBuiltin } from 'node:module'
import { dependencies } from './package.json'
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

// The icon weights Juno draws: `IconWeight` in packages/ui/src/Icon.tsx. Keep the two lists the same.
const ICON_WEIGHTS = new Set(['regular', 'bold', 'fill', 'duotone'])

/**
 * Drops the icon weights Juno never draws (thin and light) from each
 * Phosphor icon module. Every icon ships all six weights as one `Map`
 * built when the module loads, so tree shaking cannot remove the unused
 * ones; they were about a third of the icons' share of the first bundle.
 */
function phosphorWeights(): Plugin {
  const defs = /@phosphor-icons\/react\/dist\/defs\/[A-Za-z0-9]+\.es\.js$/
  return {
    name: 'juno:phosphor-weights',
    enforce: 'pre',
    transform(code, id) {
      if (!defs.test(id)) return undefined
      let out = code
      for (const weight of ['thin', 'light']) {
        if (ICON_WEIGHTS.has(weight)) continue
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

// electron-vite defaults every target to `minify: false`. Minified output is
// less than half the size and parses faster; scripts/check-bundle-size.mjs
// holds the renderer to the budget in docs/performance.md.
// JUNO_UNMINIFIED=1 keeps function names for a CPU profile (scripts/perf-trace.mjs).
const minify = process.env['JUNO_UNMINIFIED'] === '1' ? false : ('esbuild' as const)

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
    define: { __JUNO_UPDATE_FEED_URL__: JSON.stringify(process.env.JUNO_UPDATE_FEED_URL ?? '') },
    plugins: [externalize, runtimeImports()],
    build: {
      minify,
      rollupOptions: {
        // index.js is the main process; engine.js and agent.js are forked as utility processes.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          engine: resolve(__dirname, 'src/engine/index.ts'),
          agent: resolve(__dirname, 'src/agent/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalize, runtimeImports()],
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

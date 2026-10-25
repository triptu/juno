/**
 * The renderer's Vite plugins that the Electron build and the web shell
 * (`web/host`) share, so both serve the same compiled components and styles:
 * the Phosphor weights Juno draws, StyleX, and React with the React Compiler.
 * The Electron-only plugins (the Content Security Policy, the font preloads)
 * stay in electron.vite.config.ts.
 *
 * The repo root comes in as an argument: electron-vite and plain Node load
 * this file differently, and neither `__dirname` nor `import.meta.dirname`
 * works in both.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PluginOption, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import stylex from '@stylexjs/unplugin'
import { reactCompiler } from './react-compiler.vite'

// The icon weights Juno draws: `IconWeight` in packages/ui/src/Icon.tsx. Keep the two lists the same.
const ICON_WEIGHTS = new Set(['regular', 'bold', 'fill'])

/** The icons that draw duotone: the ones packages/ui/src/duotone.ts imports, the only way to draw it. */
function duotoneIcons(repoRoot: string): Set<string> {
  const source = readFileSync(resolve(repoRoot, 'packages/ui/src/duotone.ts'), 'utf8')
  const icons = new Set(Array.from(source.matchAll(/@phosphor-icons\/react\/dist\/icons\/([A-Za-z0-9]+)'/g), (match) => match[1] ?? ''))
  if (!icons.has('Sparkle')) throw new Error('juno:phosphor-weights: found no duotone icons in packages/ui/src/duotone.ts')
  return icons
}

/**
 * Drops the icon weights Juno never draws from each Phosphor icon module:
 * thin and light everywhere, and duotone from every icon `duotone.ts` does
 * not import. Every icon ships all six weights as one `Map` built when the
 * module loads, so tree shaking cannot remove the unused ones. Thin and
 * light were about a third of the icons' share of the first bundle
 * (10-15), duotone about 40 KB more (10-17).
 */
function phosphorWeights(repoRoot: string): Plugin {
  const defs = /@phosphor-icons\/react\/dist\/defs\/([A-Za-z0-9]+)\.es\.js$/
  const duotone = duotoneIcons(repoRoot)
  return {
    name: 'juno:phosphor-weights',
    enforce: 'pre',
    transform(code, id) {
      const icon = defs.exec(id)?.[1]
      if (icon === undefined) return undefined
      let out = code
      for (const weight of ['thin', 'light', 'duotone']) {
        if (ICON_WEIGHTS.has(weight) || (weight === 'duotone' && duotone.has(icon))) continue
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
 * `repoRoot` is the monorepo root: StyleX hashes class names relative to it
 * and needs it to resolve the workspace token package, no matter which
 * directory the build is started from. `minify` minifies the StyleX sheet,
 * which the plugin writes after Vite has minified the CSS: about 21 KB of
 * the first stylesheet was line breaks and indents (10-21). `reportSkipped`
 * (default true) prints each function the React Compiler left as written.
 */
export function rendererPlugins(options: { readonly repoRoot: string; readonly minify: boolean; readonly reportSkipped?: boolean; readonly cssLayers?: boolean }): PluginOption[] {
  return [
    phosphorWeights(options.repoRoot),
    stylex.vite({
      // The DOM lane's bundle (dom/vite.config.ts) turns them off: happy-dom's cascade skips rules inside @layer.
      useCSSLayers: options.cssLayers !== false,
      lightningcssOptions: { minify: options.minify },
      unstable_moduleResolution: { type: 'commonJS', rootDir: options.repoRoot },
    }),
    // The React Compiler memoizes components and hooks at build time (react-compiler.vite.ts), on the
    // workspace packages' source too. A component it cannot compile is left as written; the build prints which one and why.
    reactCompiler(options.repoRoot, options.reportSkipped !== false),
    react(),
  ]
}

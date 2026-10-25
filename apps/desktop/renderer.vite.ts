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
import { parseSync, Visitor, type ESTree, type PluginOption, type Plugin } from 'vite'
import stylex from '@stylexjs/unplugin'
import { reactWithCompiler } from './react-compiler.vite'

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
 * The renderer's output chunks: everything the first screen imports in one
 * file, as Rollup made it. On its own, Rolldown puts each module the first
 * screen shares with a lazy chunk in a chunk of its own, and the first screen
 * loaded 65 files (10-25). `$initial` is every module the entry reaches by
 * static imports, before tree shaking: a lazy-only module that a first-screen
 * module imports, even for code nobody calls at start, lands in this file
 * (performance.md, "Vite 8 first screen").
 */
export const rendererOutput = { codeSplitting: { groups: [{ name: 'index', tags: ['$initial' as const] }] } }

const tokensModule = /\/packages\/tokens\/src\/tokens\.stylex\.ts$/

/** The names a pattern (a declaration, a parameter) binds. */
function boundNames(pattern: ESTree.Node | null | undefined, into: Set<string>): void {
  if (pattern == null) return
  if (pattern.type === 'Identifier') into.add(pattern.name)
  else if (pattern.type === 'ObjectPattern') for (const property of pattern.properties) boundNames(property.type === 'RestElement' ? property.argument : property.value, into)
  else if (pattern.type === 'ArrayPattern') for (const element of pattern.elements) boundNames(element, into)
  else if (pattern.type === 'RestElement') boundNames(pattern.argument, into)
  else if (pattern.type === 'AssignmentPattern') boundNames(pattern.left, into)
}

/**
 * Replaces each read of one token, `colors['--background-subtle']`, with the
 * value StyleX compiles it to, `'var(--background-subtle)'`, after StyleX has
 * run. Rollup dropped the keys of a token group nobody read; Rolldown keeps
 * every group a chunk imports whole, 21 KB of the first screen (10-25). The
 * tokens module itself is checked, so a token whose value is not
 * `var(<its key>)` fails the build. A file that declares a name of its own
 * equal to an imported token group is left as it is.
 */
function inlineTokenReads(): Plugin {
  return {
    name: 'juno:inline-token-reads',
    apply: 'build',
    enforce: 'post',
    transform(code, id) {
      const [file = id] = id.split('?')
      if (tokensModule.test(file)) {
        for (const match of code.matchAll(/["'](--[\w-]+)["']\s*:\s*["'`]([^"'`]*)["'`]/g)) {
          if (match[2] !== `var(${match[1]})`) this.error(`juno:inline-token-reads: ${match[1]} compiles to ${match[2]}, not var(${match[1]})`)
        }
        return undefined
      }
      if (!/\.[cm]?[jt]sx?$/.test(file) || file.includes('/node_modules/') || !code.includes('tokens.stylex')) return undefined
      const { program } = parseSync(file, code)
      const groups = new Set<string>()
      for (const node of program.body) {
        if (node.type !== 'ImportDeclaration' || !/(?:^|\/)tokens\.stylex(?:\.ts)?$/.test(node.source.value)) continue
        for (const specifier of node.specifiers) if (specifier.type === 'ImportSpecifier') groups.add(specifier.local.name)
      }
      if (groups.size === 0) return undefined
      const reads: Array<{ readonly group: string; readonly start: number; readonly end: number; readonly value: string }> = []
      const declared = new Set<string>()
      const functionLike = (node: { readonly id?: ESTree.Node | null; readonly params: ReadonlyArray<ESTree.Node> }) => {
        boundNames(node.id, declared)
        for (const param of node.params) boundNames(param, declared)
      }
      new Visitor({
        VariableDeclarator: (node) => boundNames(node.id, declared),
        FunctionDeclaration: functionLike,
        FunctionExpression: functionLike,
        ArrowFunctionExpression: functionLike,
        ClassDeclaration: (node) => boundNames(node.id, declared),
        ClassExpression: (node) => boundNames(node.id, declared),
        CatchClause: (node) => boundNames(node.param, declared),
        MemberExpression: (node) => {
          if (!node.computed || node.object.type !== 'Identifier' || !groups.has(node.object.name)) return
          const key = node.property
          if (key.type !== 'Literal' || typeof key.value !== 'string' || !key.value.startsWith('--')) return
          reads.push({ group: node.object.name, start: node.start, end: node.end, value: JSON.stringify(`var(${key.value})`) })
        },
      }).visit(program)
      const kept = reads.filter((read) => !declared.has(read.group))
      if (kept.length === 0) return undefined
      let out = ''
      let at = 0
      // The visitor walks in source order, so the reads are in order.
      for (const read of kept) {
        out += code.slice(at, read.start) + read.value
        at = read.end
      }
      return { code: out + code.slice(at), map: null }
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
    inlineTokenReads(),
    stylex.vite({
      // The DOM lane's bundle (dom/vite.config.ts) turns them off: happy-dom's cascade skips rules inside @layer.
      useCSSLayers: options.cssLayers !== false,
      lightningcssOptions: { minify: options.minify },
      unstable_moduleResolution: { type: 'commonJS', rootDir: options.repoRoot },
    }),
    // The React Compiler memoizes components and hooks at build time (react-compiler.vite.ts), on the
    // workspace packages' source too. A component it cannot compile is left as written; the build prints which one and why.
    ...reactWithCompiler(options.repoRoot, options.reportSkipped !== false),
  ]
}

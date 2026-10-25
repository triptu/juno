/**
 * The React Compiler pass (performance.md 5.4), as a Vite plugin with a
 * per-file cache. It runs the same Babel transform that `@vitejs/plugin-react`
 * 5 runs in a production build, so the output is the same, and it stores each
 * result under a hash of the file's path and source, the compiler's options,
 * the build mode and `bun.lock`, which pins Babel and the compiler. The compiler looks at one file at a time,
 * so a file whose source did not change gets the stored result. The pass was
 * about 60% of a cold renderer, web or gallery build (10-25); a new commit
 * changes few files, so most builds read nearly all of it from the cache.
 *
 * The cache lives in `JUNO_BUILD_CACHE_DIR` (the remote runner's persistent
 * `/cache/builds`, shared by every job and build) or the system temp folder.
 * `JUNO_REACT_COMPILER_CACHE=0` turns it off; `bun run package` does, so a
 * release compiles every file.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transformAsync } from '@babel/core'
import reactCompilerPlugin from 'babel-plugin-react-compiler'
import type { Plugin, Rollup } from 'vite'

const include = /\.[tj]sx?$/
const exclude = /\/node_modules\//
const options = { target: '19' } as const
const maxAgeMillis = 7 * 24 * 60 * 60 * 1000

type Entry = { readonly code: string; readonly map: unknown; readonly skipped: ReadonlyArray<string> }

function cacheDir(): string | undefined {
  if (process.env['JUNO_REACT_COMPILER_CACHE'] === '0') return undefined
  return join(process.env['JUNO_BUILD_CACHE_DIR'] ?? join(tmpdir(), 'juno-cache'), 'react-compiler-v1')
}

/** Removes entries no build has written for a week, at most once a day. Hits do not refresh an entry. */
function prune(dir: string): void {
  const stamp = join(dir, '.pruned')
  try {
    if (Date.now() - statSync(stamp).mtimeMs < 24 * 60 * 60 * 1000) return
  } catch {}
  mkdirSync(dir, { recursive: true })
  writeFileSync(stamp, '')
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    try {
      // A build killed mid-write can leave a temporary file.
      if (/\.(?:json|tmp)$/.test(name) && Date.now() - statSync(path).mtimeMs > maxAgeMillis) rmSync(path, { force: true })
    } catch {}
  }
}

/**
 * `repoRoot` is the monorepo root, where `bun.lock` is. `reportSkipped` prints
 * each function the compiler left as written, also for cached files.
 */
export function reactCompiler(repoRoot: string, reportSkipped: boolean): Plugin {
  const dir = cacheDir()
  const lock = createHash('sha256').update(readFileSync(join(repoRoot, 'bun.lock'))).digest('hex')
  let root = process.cwd()
  let ssr = false
  return {
    name: 'juno:react-compiler',
    enforce: 'pre',
    configResolved(config) {
      root = config.root
      ssr = Boolean(config.build.ssr)
    },
    buildStart() {
      if (dir !== undefined) prune(dir)
    },
    async transform(code, id) {
      const [file = id] = id.split('?')
      if (ssr || !include.test(file) || exclude.test(file)) return undefined
      // The compiler adds code that resets a component's memo cache on edit when NODE_ENV is
      // `development` or `globalThis.__DEV__` is true, read as each file compiles; Babel reads
      // BABEL_ENV and NODE_ENV. A dev server's results must not reach a build, so all three are in the key.
      const mode = [process.env['NODE_ENV'] ?? null, process.env['BABEL_ENV'] ?? null, (globalThis as { __DEV__?: unknown }).__DEV__ === true]
      const key = createHash('sha256').update(JSON.stringify([lock, options, mode, root, id, code])).digest('hex')
      const path = dir === undefined ? undefined : join(dir, `${key}.json`)
      let entry: Entry | undefined
      if (path !== undefined) {
        try {
          entry = JSON.parse(readFileSync(path, 'utf8')) as Entry
        } catch {}
      }
      if (entry === undefined) {
        const skipped: string[] = []
        const parserPlugins: Array<'jsx' | 'typescript'> = []
        if (!file.endsWith('.ts')) parserPlugins.push('jsx')
        if (/\.tsx?$/.test(file)) parserPlugins.push('typescript')
        // The options @vitejs/plugin-react 5 passes in a production build.
        const result = await transformAsync(code, {
          babelrc: false,
          configFile: false,
          root,
          filename: id,
          sourceFileName: file,
          retainLines: false,
          parserOpts: { sourceType: 'module', allowAwaitOutsideFunction: true, plugins: parserPlugins },
          generatorOpts: { importAttributesKeyword: 'with', decoratorsBeforeExport: true },
          plugins: [
            [
              reactCompilerPlugin,
              {
                ...options,
                logger: {
                  logEvent(_filename: string | null, event: { kind: string; detail?: { reason?: string } }) {
                    if (event.kind === 'CompileError' || event.kind === 'PipelineError') skipped.push(event.detail?.reason ?? event.kind)
                  },
                },
              },
            ],
          ],
          sourceMaps: true,
        })
        if (!result?.code) return undefined
        entry = { code: result.code, map: result.map, skipped }
        if (path !== undefined) {
          // Written whole under another name, then renamed, so a parallel build never reads half a file.
          try {
            mkdirSync(dir!, { recursive: true })
            const temporary = `${path}.${randomUUID()}.tmp`
            writeFileSync(temporary, JSON.stringify(entry))
            renameSync(temporary, path)
          } catch {}
        }
      }
      if (reportSkipped) for (const reason of entry.skipped) console.warn(`react-compiler: skipped a function in ${id}: ${reason}`)
      return { code: entry.code, map: entry.map as Rollup.SourceMapInput }
    },
  }
}

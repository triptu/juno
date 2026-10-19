// Which files are tests, for pnpm affected (scripts/affected.mjs): the vitest
// files of every package and app, and the Node tests of the repository's
// scripts with the root script that runs each.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const globPattern = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/|\*/g, (part) => part === '**/' ? '(?:.*/)?' : '[^/]*')}$`)

/**
 * Whether a repo path is a vitest file: in a package or app under `packages/`
 * or `apps/` whose `test` script runs vitest, a file its `vitest.config.ts`
 * includes (every project's `include`; `test/**\/*.test.ts` when it names none).
 */
export function unitTestMatcher(root) {
  const patterns = new Map()
  const patternsOf = (dir) => {
    if (!patterns.has(dir)) {
      const manifest = join(root, dir, 'package.json')
      const runsVitest = existsSync(manifest) && /\bvitest\b/.test(JSON.parse(readFileSync(manifest, 'utf8')).scripts?.test ?? '')
      const config = join(root, dir, 'vitest.config.ts')
      const globs = runsVitest && existsSync(config) ? [...readFileSync(config, 'utf8').matchAll(/include:\s*\[([^\]]*)\]/g)].flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((glob) => glob[1])) : []
      patterns.set(dir, runsVitest ? (globs.length > 0 ? globs : ['test/**/*.test.ts']).map(globPattern) : [])
    }
    return patterns.get(dir)
  }
  return (file) => {
    const parts = file.split('/')
    return /^(packages|apps)$/.test(parts[0]) && parts.length > 2 && patternsOf(parts.slice(0, 2).join('/')).some((pattern) => pattern.test(parts.slice(2).join('/')))
  }
}

/** A script and the scripts it imports, following relative imports. */
function scriptImports(root, file, seen = new Set()) {
  if (seen.has(file) || !existsSync(join(root, file))) return seen
  seen.add(file)
  for (const match of readFileSync(join(root, file), 'utf8').matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) scriptImports(root, join(dirname(file), match[1]), seen)
  return seen
}

/**
 * Each root script that runs `node --test <files>`, with `reached`: the
 * changed files that are one of its tests or a file they import, each with the
 * test (`{ test, file }`).
 */
export function nodeTestScripts(root, changed) {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts
  return Object.entries(scripts)
    .filter(([, command]) => /\bnode --test\b/.test(command))
    .map(([script, command]) => {
      const tests = command.split(/\s+/).filter((word) => /\.test\.[cm]?js$/.test(word))
      return { script, reached: tests.flatMap((test) => [...scriptImports(root, test)].filter((file) => changed.includes(file)).map((file) => ({ test, file }))) }
    })
}

/** File import closures plus package configs, shared by selection and its cache. */
export function unitTestItems(root, files, changed, closure) {
  return [...files]
    .filter(unitTestMatcher(root))
    .map((file) => {
      const dir = file.split('/').slice(0, 2).join('/')
      const config = [`${dir}/package.json`, `${dir}/vitest.config.ts`, `${dir}/tsconfig.json`]
      return { suite: 'test', id: file, inputs: new Set([...closure(file), ...config]), own: changed.some((path) => config.includes(path)) }
    })
}

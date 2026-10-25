/**
 * The React Compiler cache (react-compiler.vite.ts) is shared by dev servers and
 * builds. On 10-25 a dev web shell's results, which reset each memo cache on
 * edit, were read back by a production build and pushed the first bundle 18 KB
 * over its budget. A build after a dev server must get what an uncached build gets.
 */
import { afterEach, expect, it } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { reactCompiler } from '../react-compiler.vite'

const repoRoot = resolve(__dirname, '../../..')
const source = `import { useState } from 'react'
export function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{label} {count}</button>
}
`
const saved = { NODE_ENV: process.env['NODE_ENV'], JUNO_BUILD_CACHE_DIR: process.env['JUNO_BUILD_CACHE_DIR'], JUNO_REACT_COMPILER_CACHE: process.env['JUNO_REACT_COMPILER_CACHE'] }
const dirs: string[] = []
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function compile(env: Record<string, string>): Promise<string> {
  Object.assign(process.env, env)
  // The three hooks the plugin has, called as Vite calls them in a build.
  const plugin = reactCompiler(repoRoot, false) as unknown as {
    configResolved(config: unknown): void
    buildStart(): void
    transform(code: string, id: string): Promise<{ code: string }>
  }
  plugin.configResolved({ root: repoRoot, build: { ssr: false } })
  plugin.buildStart()
  return (await plugin.transform(source, join(repoRoot, 'packages/views/src/Counter.tsx'))).code
}

it('a build after a dev server compiles as an uncached build does, then reads its own results back', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'juno-react-compiler-'))
  dirs.push(cache)
  const uncached = await compile({ NODE_ENV: 'production', JUNO_REACT_COMPILER_CACHE: '0' })
  delete process.env['JUNO_REACT_COMPILER_CACHE']

  const dev = await compile({ NODE_ENV: 'development', JUNO_BUILD_CACHE_DIR: cache })
  expect(dev).not.toBe(uncached)

  expect(await compile({ NODE_ENV: 'production', JUNO_BUILD_CACHE_DIR: cache })).toBe(uncached)
  const entries = readdirSync(join(cache, 'react-compiler-v1')).filter((name) => name.endsWith('.json'))
  expect(entries).toHaveLength(2)
  expect(await compile({ NODE_ENV: 'production', JUNO_BUILD_CACHE_DIR: cache })).toBe(uncached)
  expect(readdirSync(join(cache, 'react-compiler-v1')).filter((name) => name.endsWith('.json'))).toEqual(entries)
})

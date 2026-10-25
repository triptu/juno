import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImportGraph } from '../../scripts/import-graph.mjs'

const ignored = new Set(['node_modules', '.git', 'dist', 'out', 'test-results', 'playwright-report', 'shots', 'coverage'])
const filesUnder = (root, dir) => !existsSync(join(root, dir)) ? [] : readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
  if (ignored.has(entry.name)) return []
  const file = `${dir}/${entry.name}`
  return entry.isDirectory() ? filesUnder(root, file) : [file]
})
const digest = value => createHash('sha256').update(value).digest('hex')

class LayoutGraph extends ImportGraph {
  throughBarrel(file, names) {
    const selected = super.throughBarrel(file, names)
    // An alias or unfamiliar re-export must widen the key, never drop a dependency.
    return selected?.some(([, targets]) => targets.length === 0) ? undefined : selected
  }
}

/** Each registered component's fixture file, from the registries' imports. */
function registeredFixtures(root, graph, files) {
  const registries = ['ui', 'views', 'huddle-views'].map(name => `packages/${name}/src/fixtures.ts`).filter(file => files.has(file))
  const components = new Map()
  for (const registry of registries) {
    const text = readFileSync(join(root, registry), 'utf8')
    const sources = new Map()
    for (const match of text.matchAll(/import\s+([\w{},\s]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
      const target = graph.resolveImport(registry, match[2])
      if (!target) continue
      for (const binding of match[1].replace(/[{}]/g, '').split(',')) {
        const local = binding.trim().split(/\s+as\s+/).at(-1)
        if (local) sources.set(local, target)
      }
    }
    for (const match of text.slice(text.indexOf('export const fixtures')).matchAll(/^\s+(\w+)(?::\s*(\w+))?,/gm)) {
      const source = sources.get(match[2] ?? match[1])
      if (source) components.set(match[1], source)
    }
  }
  return { registries, components }
}

/** Source keys work in remote archives too: no Git metadata or worktree paths. */
export function sourceKeys(root, kind) {
  const files = new Set([...filesUnder(root, 'packages'), ...filesUnder(root, 'apps/gallery')])
  const graph = new LayoutGraph(root, files)
  const { registries, components } = registeredFixtures(root, graph, files)

  const shared = new Set([
    'bun.lock', 'bunfig.toml', 'package.json', 'tsconfig.base.json',
    'scripts/import-graph.mjs', 'scripts/build-cached.mjs',
    'apps/gallery/package.json', 'apps/gallery/index.html', 'apps/gallery/vite.config.ts',
    'apps/gallery/playwright.config.ts', 'apps/gallery/support.ts', 'apps/gallery/walk-cache.mjs',
    `apps/gallery/${kind === 'shift' ? 'shift' : 'focus-ring'}.spec.ts`,
    ...registries,
  ])
  for (const file of files) {
    if (/^apps\/gallery\/(src|public)\//.test(file) || /^packages\/(tokens|testing)\//.test(file)
      || /^packages\/[^/]+\/package\.json$/.test(file)
      || /^packages\/(ui|views|huddle-views)\/.*\.(css|woff2?|ttf|otf|svg|png|jpg|webp)$/.test(file)) shared.add(file)
  }
  for (const file of ['apps/gallery/vite.config.ts', 'apps/gallery/support.ts']) {
    if (files.has(file)) for (const reached of graph.closure(file)) shared.add(reached)
  }
  // Frame, theme and highlighting imports affect every state. Registries and
  // compositions select fixtures; following those globally would erase locality.
  for (const file of files) {
    if (!file.startsWith('apps/gallery/src/') || /\/(registry|compositions|testFixtures)\./.test(file)) continue
    for (const entry of graph.importsOf(file)) {
      if (entry.target.startsWith('apps/gallery/') || registries.includes(entry.target)) continue
      for (const landing of graph.landing(entry.target, entry.named)) {
        for (const reached of graph.closure(landing)) shared.add(reached)
      }
    }
  }
  // Hash actual bundled font bytes as well as the dependency lockfile.
  for (const file of filesUnder(root, 'apps/gallery/dist/assets')) if (/\.(woff2?|ttf|otf)$/.test(file)) shared.add(file)
  for (const dir of ['', 'apps/gallery']) {
    for (const entry of readdirSync(join(root, dir))) if (/^\.env(?:\.|$)/.test(entry)) shared.add(dir ? `${dir}/${entry}` : entry)
  }
  const hashes = new Map()
  const hash = file => {
    if (!hashes.has(file)) hashes.set(file, existsSync(join(root, file)) ? digest(readFileSync(join(root, file))) : null)
    return hashes.get(file)
  }
  const hashFiles = inputs => digest(JSON.stringify([...inputs].toSorted().map(file => [file, hash(file)])))
  const base = hashFiles(shared)
  const keys = new Map()
  return component => {
    if (!keys.has(component)) {
      const fixture = components.get(component)
      // Unknown registrations (including compositions) conservatively depend on
      // all source. A new registration must never acquire an incomplete key.
      const inputs = fixture ? graph.closure(fixture) : files
      keys.set(component, digest(JSON.stringify([base, hashFiles(inputs)])))
    }
    return keys.get(component)
  }
}

/**
 * Keys over a component's own files only: its fixture file and the files it
 * reaches that are named after it (`Button.tsx`, `Button.stylex.ts`, a
 * `Button/` folder). A change to a shared primitive, a token or the test code
 * leaves them alone. Gallery compositions are keyed by the gallery's own
 * registration files. The shift walk uses them to pick the states whose own
 * component changed.
 */
export function ownKeys(root) {
  const files = new Set([...filesUnder(root, 'packages'), ...filesUnder(root, 'apps/gallery')])
  const graph = new LayoutGraph(root, files)
  const { components } = registeredFixtures(root, graph, files)
  const gallery = [...files].filter(file => /^apps\/gallery\/src\/(compositions|testFixtures)\./.test(file))
  const keys = new Map()
  return component => {
    if (!keys.has(component)) {
      const fixture = components.get(component)
      const stem = fixture?.split('/').at(-1).split('.')[0]
      const named = file => file === fixture || file.split('/').some((part, index, parts) => part === stem || (index === parts.length - 1 && part.split('.')[0] === stem))
      const inputs = fixture ? [...graph.closure(fixture)].filter(named) : gallery
      keys.set(component, digest(JSON.stringify(inputs.toSorted().map(file => [file, existsSync(join(root, file)) ? digest(readFileSync(join(root, file))) : null]))))
    }
    return keys.get(component)
  }
}

/** Immutable successful state records beside the shared build/results caches. */
export function walkCache({ root, kind, runtime, directory, all = false, own = false }) {
  const componentKey = own ? ownKeys(root) : sourceKeys(root, kind)
  const cache = directory ?? join(process.env.JUNO_BUILD_CACHE_DIR ?? join(tmpdir(), 'juno-cache', 'results'), 'gallery-walk-v1')
  const environment = Object.entries(process.env).filter(([name]) => /^(VITE_|ELECTRON_VITE_)/.test(name) || ['NODE_ENV', 'JUNO_UNMINIFIED'].includes(name)).toSorted()
  const key = route => digest(JSON.stringify({ kind, own, route, runtime, environment, source: componentKey(route.component) }))
  const record = route => `${kind} ${route.route}\n`
  return {
    key,
    /** True when every state is checked again whatever its record. */
    all,
    passed(route) {
      if (all) return false
      try { return readFileSync(join(cache, key(route)), 'utf8') === record(route) } catch { return false }
    },
    forget(route) { rmSync(join(cache, key(route)), { force: true }) },
    pass(route) {
      mkdirSync(cache, { recursive: true })
      const target = join(cache, key(route))
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        writeFileSync(temporary, record(route))
        renameSync(temporary, target)
      } finally { rmSync(temporary, { force: true }) }
    },
  }
}

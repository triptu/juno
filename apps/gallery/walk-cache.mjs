import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImportGraph } from '../../scripts/import-graph.mjs'
import { lockedPackages } from '../../scripts/locked-packages.mjs'
import { layoutCss, layoutTokens, tokenFiles } from './layout-tokens.mjs'

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

/**
 * Source keys work in remote archives too: no Git metadata or worktree paths.
 * `shift` keys on the walk and what can move a box; `layout` and
 * `paint` key the cached rendering tests (support.ts), whose own code counts
 * through `specKey`. `paint` also counts colour and shadow tokens and CSS
 * declarations that only paint.
 */
export function sourceKeys(root, kind) {
  const files = new Set([...filesUnder(root, 'packages'), ...filesUnder(root, 'apps/gallery')])
  const graph = new LayoutGraph(root, files)
  const registries = ['ui', 'views', 'huddle-views'].map(name => `packages/${name}/src/fixtures.ts`).filter(file => files.has(file))
  const components = fixtureSources(root, graph, registries)
  const galleryOwn = galleryFixtureSources(root, files)

  // What a walk does to a state. The spec's other tests (delayed loads, the guard's
  // self-tests) are not part of it; the guard is, through the walk's imports.
  const walk = { shift: 'apps/gallery/shift-walk.ts' }[kind]
  const paint = kind === 'paint'
  const shared = new Set([
    'bunfig.toml', 'tsconfig.base.json',
    'scripts/import-graph.mjs', 'scripts/locked-packages.mjs', 'scripts/build-cached.mjs', 'scripts/build-inputs.mjs',
    'apps/gallery/index.html', 'apps/gallery/vite.config.ts',
    'apps/gallery/walk-cache.mjs', 'apps/gallery/layout-tokens.mjs',
    ...registries,
  ])
  for (const file of files) {
    // Compositions and test fixtures register states of their own, which key on all source.
    if (/^apps\/gallery\/(src|public)\/(?!(compositions|testFixtures)\.)/.test(file) || /^packages\/tokens\/src\/.*\.(css|woff2?|ttf|otf)$/.test(file)
      || /^packages\/(ui|views|huddle-views)\/.*\.(css|woff2?|ttf|otf|svg|png|jpg|webp)$/.test(file)) shared.add(file)
  }
  for (const file of ['apps/gallery/vite.config.ts', walk].filter(Boolean)) {
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

  // Token files key by value: each record holds the values of the layout tokens
  // its files read, and the rest of the two files.
  const tokens = layoutTokens(root, files, graph)
  const source = inputs => [...inputs].filter(file => !tokenFiles.includes(file))
  const hashes = new Map()
  const hash = file => {
    if (!hashes.has(file)) {
      const path = join(root, file)
      hashes.set(file, !existsSync(path) ? null : file.endsWith('.css') && !paint ? digest(layoutCss(readFileSync(path, 'utf8'))) : digest(readFileSync(path)))
    }
    return hashes.get(file)
  }
  const hashFiles = inputs => digest(JSON.stringify(source(inputs).toSorted().map(file => [file, hash(file)])))
  const tokenKey = inputs => tokens.key(inputs, { paint })
  const sharedTokens = tokenKey(shared)
  const keys = new Map()
  let index
  const indexInputs = () => index ??= stateListInputs(graph, registries, components)
  const inputsOf = component => component === '#index' ? indexInputs()
    : components.has(component) ? graph.closure(components.get(component))
    : galleryOwn.has(component) ? graph.closure(galleryOwn.get(component)) : files
  const reached = new Set([...shared, ...[...components.keys(), ...galleryOwn.keys()].flatMap(component => [...inputsOf(component)])])
  const base = digest(JSON.stringify([hashFiles(shared), tokens.structure, sharedTokens, packagesKey(root, files, reached)]))
  const componentKey = component => {
    if (!keys.has(component)) {
      // Unknown registrations (including compositions) conservatively depend on
      // all source. A new registration must never acquire an incomplete key.
      const inputs = inputsOf(component)
      keys.set(component, digest(JSON.stringify([base, hashFiles(inputs), tokenKey(inputs)])))
    }
    return keys.get(component)
  }
  /** A test file and what it imports. */
  componentKey.specKey = file => digest(JSON.stringify([hashFiles(graph.closure(file)), packagesKey(root, files, graph.closure(file))]))
  return componentKey
}

/** The gallery's own compositions and test fixtures key on their file and what it imports. */
function galleryFixtureSources(root, files) {
  const sources = new Map()
  for (const [file, name] of [['apps/gallery/src/compositions.tsx', 'compositions'], ['apps/gallery/src/testFixtures.tsx', 'testFixtures']]) {
    if (!files.has(file)) continue
    const text = readFileSync(join(root, file), 'utf8')
    for (const match of text.slice(text.indexOf(`export const ${name}`)).matchAll(/^ {2}(\w+): defineFixtures\(/gm)) sources.set(match[1], file)
  }
  return sources
}

/**
 * `#index`, the gallery's list of states: the registries and the fixture modules
 * and helpers that declare them. A state list built from a constant outside
 * fixture code is missed until a full run.
 */
function stateListInputs(graph, registries, components) {
  const fixtureCode = file => /(^|\/)fixtures(\/|\.)|\.fixtures\./.test(file)
  return new Set([...registries, 'apps/gallery/src/compositions.tsx', 'apps/gallery/src/testFixtures.tsx',
    ...[...new Set(components.values())].flatMap(source => [...graph.closure(source)].filter(fixtureCode))])
}

/** Which fixture module each registered component name comes from. */
function fixtureSources(root, graph, registries) {
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

  return components
}

/**
 * The packages the reached files belong to and import from outside the
 * workspace: the manifest fields that decide how imports resolve, and the
 * locked versions of what they import and the gallery builds with.
 */
function packagesKey(root, files, reached) {
  const packageDirs = new Set(['apps/gallery', ...[...reached].map(file => /^(packages\/[^/]+)\//.exec(file)?.[1]).filter(dir => dir && files.has(`${dir}/package.json`))])
  const manifests = Object.fromEntries(['package.json', ...[...packageDirs].toSorted().map(dir => `${dir}/package.json`)].map(file => [file, manifest(root, file)]))
  const workspace = new Set(Object.values(manifests).map(entry => entry?.name))
  const imported = new Set()
  for (const file of reached) {
    if (!/\.(ts|tsx|mjs|js|css)$/.test(file) || !existsSync(join(root, file))) continue
    const owner = manifests[`${/^((?:packages|apps)\/[^/]+)\//.exec(file)?.[1]}/package.json`]?.name ?? ''
    for (const match of readFileSync(join(root, file), 'utf8').matchAll(/(?:(?:import|export)\s+[\w*{}\s,$]*?from\s*|\bimport\s*\(?\s*|\brequire\(\s*|@import\s+(?:url\()?)['"]([^'"]+)['"]/g)) {
      const name = /^(?:@[\w.-]+\/)?[\w.-]+(?=\/|$)/.exec(match[1])?.[0]
      if (name && !/^[./]|^\w+:/.test(match[1]) && !workspace.has(name)) imported.add(`${owner} ${name}`)
    }
  }
  const gallery = manifests['apps/gallery/package.json'] ?? {}
  for (const name of Object.keys({ ...gallery.dependencies, ...gallery.devDependencies })) if (!workspace.has(name)) imported.add(`@juno/gallery ${name}`)
  const resolution = Object.fromEntries(Object.entries(manifests).map(([file, entry]) => [file, entry && pick(entry, file === 'package.json' ? rootFields : packageFields)]))
  return [resolution, lockedPackages(root, [...imported].toSorted().map(entry => entry.split(' ')))]
}

/** Manifest fields that decide how an import resolves; dependency ranges count through the lockfile. */
const packageFields = ['name', 'type', 'exports', 'imports', 'main', 'module', 'browser', 'sideEffects']
const rootFields = ['workspaces', 'packageManager', 'packageExtensions', 'overrides', 'resolutions', 'patchedDependencies', 'trustedDependencies']
const pick = (entry, fields) => Object.fromEntries(fields.filter(field => field in entry).map(field => [field, entry[field]]))
const manifest = (root, file) => existsSync(join(root, file)) ? JSON.parse(readFileSync(join(root, file), 'utf8')) : null

const cacheDirectory = directory => directory ?? join(process.env.JUNO_BUILD_CACHE_DIR ?? join(tmpdir(), 'juno-cache', 'results'), 'gallery-walk-v1')
const environment = () => Object.entries(process.env).filter(([name]) => /^(VITE_|ELECTRON_VITE_)/.test(name) || ['NODE_ENV', 'JUNO_UNMINIFIED'].includes(name)).toSorted()
const read = path => { try { return readFileSync(path, 'utf8') } catch { return undefined } }
function write(cache, name, text) {
  mkdirSync(cache, { recursive: true })
  const target = join(cache, name)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, text)
    renameSync(temporary, target)
  } finally { rmSync(temporary, { force: true }) }
}

/** Immutable successful state records beside the shared build/results caches. */
export function walkCache({ root, kind, runtime, directory, all = false }) {
  const componentKey = sourceKeys(root, kind)
  const cache = cacheDirectory(directory)
  const env = environment()
  const key = route => digest(JSON.stringify({ kind, route, runtime, environment: env, source: componentKey(route.component) }))
  const record = route => `${kind} ${route.route}\n`
  return {
    key,
    passed: route => !all && read(join(cache, key(route))) === record(route),
    forget(route) { rmSync(join(cache, key(route)), { force: true }) },
    pass(route) { write(cache, key(route), record(route)) },
  }
}

/**
 * Records for whole tests that are a pure function of what they render. A
 * test's identity is its title, its spec and what that imports, and the
 * runtime; its record also keys on every component it opened, which the last
 * pass wrote down beside the identity. A test never seen, or whose spec,
 * runtime or opened components changed, runs.
 */
export function testCache({ root, kind, runtime, directory, all = false }) {
  const componentKey = sourceKeys(root, kind)
  const cache = cacheDirectory(directory)
  const env = environment()
  const identity = (file, title) => digest(JSON.stringify({ kind, test: [file, title], runtime, environment: env, spec: componentKey.specKey(file) }))
  const key = (id, components) => digest(JSON.stringify([id, components.toSorted().map(component => [component, componentKey(component)])]))
  const opened = id => {
    const text = read(join(cache, `${id}.opened`))
    try { return text === undefined ? undefined : JSON.parse(text) } catch { return undefined }
  }
  return {
    passed(file, title) {
      if (all) return false
      const id = identity(file, title)
      const components = opened(id)
      return Array.isArray(components) && read(join(cache, key(id, components))) === `${kind} test ${title}\n`
    },
    forget(file, title) {
      const id = identity(file, title)
      const components = opened(id)
      rmSync(join(cache, `${id}.opened`), { force: true })
      if (Array.isArray(components)) rmSync(join(cache, key(id, components)), { force: true })
    },
    pass(file, title, components) {
      const id = identity(file, title)
      write(cache, key(id, [...components]), `${kind} test ${title}\n`)
      write(cache, `${id}.opened`, JSON.stringify([...components].toSorted()))
    },
  }
}

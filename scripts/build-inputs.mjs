// What each build-cached output is made from: the files its entry points and
// configs reach through imports, the folders Vite copies, the package and
// TypeScript settings around them, and the locked versions of the outside
// packages they import (docs/development.md, "Faster test runs"). Tests,
// scripts and docs outside that graph do not change a build's key.
//
// It widens to all source when it cannot follow an import: a computed
// import(), import.meta.glob, a local path that resolves to no file, or an
// output with no entry list here. A stale build is worse than a slow one.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { ImportGraph } from './import-graph.mjs'
import { lockedPackages, packageName } from './locked-packages.mjs'

/**
 * Each output by `<app> <outDir>`. `configs` are the build's own scripts and
 * config files, `entries` what the bundler starts from, `read` files a plugin
 * reads by path, `copied` folders copied whole and `tools` the packages the
 * build command runs.
 */
export const builds = {
  'apps/desktop out': {
    configs: ['apps/desktop/electron.vite.config.ts', 'scripts/build-desktop.mjs', 'scripts/check-bundle-size.mjs'],
    entries: ['apps/desktop/src/main/index.ts', 'apps/desktop/src/engine/index.ts', 'apps/desktop/src/agent/index.ts', 'apps/desktop/src/agent/codemode-worker.ts', 'apps/desktop/src/preload/index.ts', 'apps/desktop/src/renderer/index.html'],
    read: ['packages/ui/src/duotone.ts'],
    copied: ['apps/desktop/src/renderer/public'],
    tools: ['electron-vite', 'vite'],
  },
  'apps/desktop dist': {
    configs: ['apps/desktop/vite.web.config.ts', 'apps/desktop/web/build-host.mjs'],
    entries: ['apps/desktop/src/renderer/index.html', 'apps/desktop/web/page/main.ts', 'apps/desktop/web/host/testHost.ts', 'packages/agent/src/runtime/codemode-worker.ts'],
    read: ['packages/ui/src/duotone.ts'],
    copied: ['apps/desktop/src/renderer/public'],
    tools: ['vite'],
  },
  'apps/desktop dom/dist': {
    configs: ['apps/desktop/dom/vite.config.ts', 'apps/desktop/web/build-host.mjs'],
    entries: ['apps/desktop/web/page/main.ts', 'apps/desktop/web/host/testHost.ts', 'packages/agent/src/runtime/codemode-worker.ts'],
    read: ['packages/ui/src/duotone.ts'],
    copied: ['apps/desktop/dom/public'],
    tools: ['vite'],
  },
  'apps/gallery dist': {
    configs: ['apps/gallery/vite.config.ts'],
    entries: ['apps/gallery/index.html'],
    read: [],
    copied: ['apps/gallery/public'],
    tools: ['vite'],
  },
}

// Settings read from a file's folder or any folder above it: by Vite and
// esbuild (package.json type, tsconfig), Bun (bunfig) and lightningcss (browserslist).
const settingsFile = /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|bunfig\.toml|\.browserslistrc|browserslist|postcss\.config\.[^/]+|babel\.config\.[^/]+|\.babelrc[^/]*)$/
// Root package.json fields that change how packages resolve. Its scripts change often and build nothing.
const rootFields = ['name', 'type', 'workspaces', 'packageManager', 'packageExtensions', 'overrides', 'resolutions', 'patchedDependencies', 'trustedDependencies']
const extensions = ['.jsx', '.json', '/index.mjs', '/index.js']
// The specifiers of static imports, re-exports, literal import() and require(), and CSS @import, on one line each.
const specifierPattern = /(?<![\w.$'"`])(?:(?:import|export)\s+(?:type\s+)?[\w*{}\s,$]*?\s*from\s*|import\s*\(?\s*|require\(\s*|@import\s+(?:url\()?)['"]([^'"\n]+)['"]/g

export class BuildGraph extends ImportGraph {
  constructor(root, files) {
    super(root, files)
    this.widened = []
    this.outside = new Set()
  }

  /** Whole modules: a bundle keeps a barrel's side effects, so every re-export counts. */
  throughBarrel() {
    return undefined
  }

  resolveImport(from, specifier) {
    // `?url`, `?worker` and the like name the same file.
    const path = specifier.replace(/[?#].*$/, '')
    const found = super.resolveImport(from, path)
    if (found) return found
    // TypeScript's ESM style: `./name.js` for `./name.ts`.
    const typescript = path.replace(/\.(m?)js$/, '.$1ts')
    if (typescript !== path) {
      const mapped = super.resolveImport(from, typescript) ?? super.resolveImport(from, path.replace(/\.js$/, '.tsx'))
      if (mapped) return mapped
    }
    if (path.startsWith('.')) {
      const target = normalize(join(dirname(from), path))
      for (const extension of extensions) if (this.files.has(target + extension)) return target + extension
    }
    return undefined
  }

  importsOf(file) {
    if (this.parsed.has(file)) return this.parsed.get(file)
    if (file.endsWith('.html')) return this.htmlImports(file)
    const list = super.importsOf(file)
    if (!/\.(ts|tsx|mjs|js|cjs|css)$/.test(file)) return list
    const text = readFileSync(join(this.root, file), 'utf8')
    const code = file.endsWith('.css') ? text.replace(/\/\*[\s\S]*?\*\//g, '') : text.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/.*$/gm, '$1')
    const specifiers = [...code.matchAll(specifierPattern)].map((match) => match[1])
    for (const match of code.matchAll(/new\s+URL\(\s*(?:['"]([^'"]+)['"]|([^,)]+))\s*,\s*import\.meta\.url/g)) {
      if (match[1] === undefined) this.widened.push(`${file}: new URL(${match[2].trim()}, import.meta.url)`)
      else specifiers.push(match[1])
    }
    if (file.endsWith('.css')) {
      for (const match of code.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) if (!/^(?:data:|https?:|#)/.test(match[1])) specifiers.push(match[1])
    } else {
      if (/import\.meta\.glob/.test(code)) this.widened.push(`${file}: import.meta.glob`)
      for (const match of code.matchAll(/(?<![\w.$])(?:import|require)\(\s*(?!['"\s])([^)]{0,40})/g)) this.widened.push(`${file}: computed ${match[0]}`)
    }
    for (const specifier of specifiers) this.follow(file, specifier, list)
    return list
  }

  /** `<script src>` and `<link href>` of a Vite page; `/name` is the page's folder or its public folder. */
  htmlImports(file) {
    const list = []
    const text = readFileSync(join(this.root, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    for (const match of text.matchAll(/\s(?:src|href)=["']([^"']+)["']/g)) {
      const specifier = match[1]
      if (/^(?:data:|https?:|#)/.test(specifier)) continue
      const base = dirname(file)
      const target = specifier.startsWith('/') ? [join(base, specifier.slice(1)), join(base, 'public', specifier.slice(1))].find((path) => this.files.has(path)) : this.resolveImport(file, specifier)
      if (target) list.push({ target, named: undefined, reexport: false })
      else this.widened.push(`${file}: ${specifier} is not a file`)
    }
    this.parsed.set(file, list)
    return list
  }

  /** Records an outside package, or widens on a local path that is not a file. */
  follow(file, specifier, list) {
    const target = this.resolveImport(file, specifier)
    if (target) {
      if (!list.some((entry) => entry.target === target)) list.push({ target, named: undefined, reexport: false })
      return
    }
    const name = packageName(specifier)
    if (name && !this.packages.has(name)) this.outside.add(`${this.owner(file)} ${name}`)
    else if (!/^\w+:/.test(specifier)) this.widened.push(`${file}: ${specifier} is not a file`)
  }

  /** The workspace package a file belongs to: the nearest package.json with a name. */
  owner(file) {
    for (let dir = dirname(file); dir !== '.'; dir = dirname(dir)) {
      const manifest = `${dir}/package.json`
      if (!this.files.has(manifest)) continue
      const name = JSON.parse(readFileSync(join(this.root, manifest), 'utf8')).name
      if (name) return name
    }
    return ''
  }
}

const ignored = new Set(['node_modules', '.git', 'out', 'dist', 'test-results', 'playwright-report', 'blob-report', 'coverage', 'shots', 'feel-report', '.scratch'])
const walk = (dir) => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (ignored.has(entry.name)) return []
  const path = join(dir, entry.name)
  return entry.isDirectory() ? walk(path) : [path]
}) : []

/** Every source path under apps/, packages/, scripts/ and the root that Git sees, tracked or not; remote archives have no Git, so there it walks the folders, skipping generated ones. */
export function sourceFiles(root) {
  const rootFiles = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)
  const sources = ['apps', 'packages', 'scripts', ...rootFiles]
  const git = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...sources], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  // A deleted file that is still in the index is not an input; one the graph needs widens its key.
  if (git.status === 0 && git.stdout.length > 0) return new Set(git.stdout.split('\0').filter((file) => file && existsSync(join(root, file))))
  return new Set(sources.flatMap((name) => rootFiles.includes(name) ? [name] : walk(join(root, name)).map((file) => relative(root, file))))
}

/**
 * The inputs of one output: `files` to hash and `extra`, the root package
 * fields and locked packages, or `widened`, the reasons it keys on all source.
 * `files` is every repo path the caller sees (tracked and untracked).
 */
export function buildInputs(root, files, app, outDir) {
  const build = builds[`${app} ${outDir}`]
  if (!build) return { widened: [`no entry list for ${app} ${outDir}`] }
  const graph = new BuildGraph(root, files)
  const reached = new Set()
  for (const start of [...build.configs, ...build.entries, ...build.read]) {
    if (!files.has(start)) graph.widened.push(`${start} is missing`)
    else for (const file of graph.closure(start)) reached.add(file)
  }
  for (const dir of build.copied) for (const file of files) if (file.startsWith(`${dir}/`)) reached.add(file)
  if (graph.widened.length > 0) return { widened: graph.widened }
  const settings = new Map()
  for (const file of files) if (settingsFile.test(file)) settings.set(dirname(file), [...(settings.get(dirname(file)) ?? []), file])
  const dirs = new Set()
  for (const file of reached) for (let dir = dirname(file); !dirs.has(dir); dir = dirname(dir)) {
    dirs.add(dir)
    if (dir === '.') break
  }
  for (const dir of dirs) for (const file of settings.get(dir) ?? []) reached.add(file)
  reached.delete('package.json')
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const rootSettings = Object.fromEntries(rootFields.filter((field) => field in manifest).map((field) => [field, manifest[field]]))
  const owner = graph.owner(`${app}/package.json`)
  const outside = [...graph.outside, ...build.tools.map((name) => `${owner} ${name}`)].toSorted().map((entry) => entry.split(' '))
  return { files: [...reached].toSorted(), extra: { rootSettings, locked: lockedPackages(root, outside) } }
}

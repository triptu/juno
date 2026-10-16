// The import graph over apps/ and packages/ that scripts/affected.mjs follows:
// relative imports, @juno/* through each package's exports, and named imports
// followed through barrel re-exports (export * from, export { } from) to the
// module that declares the name.

import { readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const extensions = ['', '.ts', '.tsx', '.mjs', '.js', '.css', '/index.ts', '/index.tsx']
const importPattern = /(?:import|export)\s+(type\s+)?([\w*{}\s,$]*?)\s*from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|@import\s+(?:url\()?['"]([^'"]+)['"]/g

export class ImportGraph {
  /** `files`: every repo file under apps/ and packages/ that git sees. */
  constructor(root, files) {
    this.root = root
    this.files = files
    this.parsed = new Map()
    this.declared = new Map()
    this.closures = new Map()
    this.importerIndex = undefined
    // Workspace packages and their exports, for @juno/* imports.
    this.packages = new Map()
    for (const file of files) {
      const match = /^((?:apps|packages)\/[^/]+)\/package\.json$/.exec(file)
      if (!match) continue
      const manifest = JSON.parse(readFileSync(join(root, file), 'utf8'))
      this.packages.set(manifest.name, { dir: match[1], exports: typeof manifest.exports === 'string' ? { '.': manifest.exports } : (manifest.exports ?? {}) })
    }
  }

  resolveImport(from, specifier) {
    let target
    if (specifier.startsWith('.')) target = normalize(join(dirname(from), specifier))
    else {
      const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
      const workspace = this.packages.get(name)
      if (!workspace) return undefined
      const sub = `.${specifier.slice(name.length)}`
      const exported = workspace.exports[sub === '.' ? '.' : sub]
      const path = typeof exported === 'string' ? exported : (exported?.import ?? exported?.default)
      target = path ? normalize(join(workspace.dir, path)) : normalize(join(workspace.dir, sub))
    }
    for (const extension of extensions) if (this.files.has(target + extension)) return target + extension
    return undefined
  }

  /** Each import of a file: where it points and which names it takes (undefined means the whole module). */
  importsOf(file) {
    if (this.parsed.has(file)) return this.parsed.get(file)
    const list = []
    if (/\.(ts|tsx|mjs|js|cjs|css)$/.test(file)) {
      const text = readFileSync(join(this.root, file), 'utf8')
      for (const match of text.matchAll(importPattern)) {
        const specifier = match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[7]
        const target = this.resolveImport(file, specifier)
        if (!target) continue
        const clause = match[2]
        const named = clause && /^\{[^}]*\}$/.test(clause.trim()) ? clause.trim().slice(1, -1).split(',').map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean) : undefined
        list.push({ target, named, reexport: match[0].startsWith('export') })
      }
    }
    this.parsed.set(file, list)
    return list
  }

  /** For a barrel, which file each re-exported name comes from. */
  barrelSources(file) {
    const sources = new Map()
    const stars = []
    for (const entry of this.importsOf(file)) {
      if (!entry.reexport) continue
      if (entry.named) for (const name of entry.named) sources.set(name, entry.target)
      else stars.push(entry.target)
    }
    return { sources, stars }
  }

  /** Whether a module declares or re-exports `name` itself. */
  declares(file, name) {
    if (!this.declared.has(file)) {
      const text = /\.(ts|tsx|mjs|js)$/.test(file) ? readFileSync(join(this.root, file), 'utf8') : ''
      const names = new Set()
      for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum|namespace)\s+(\w+)/g)) names.add(match[1])
      for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) for (const part of match[1].split(',')) names.add(part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1))
      this.declared.set(file, names)
    }
    return this.declared.get(file).has(name)
  }

  /** When `file` is a barrel and `names` are imported from it, the files those names come from; otherwise undefined. */
  throughBarrel(file, names) {
    const { sources, stars } = this.barrelSources(file)
    if (!(names && (sources.size > 0 || stars.length > 0) && this.importsOf(file).every((entry) => entry.reexport))) return undefined
    return names.map((name) => [name, sources.has(name) ? [sources.get(name)] : stars.filter((candidate) => this.declares(candidate, name) || this.barrelSources(candidate).stars.length > 0)])
  }

  /** Every file `start` reaches. Named imports from a barrel reach only the files that define those names. */
  closure(start) {
    if (this.closures.has(start)) return this.closures.get(start)
    const reached = new Set()
    const seen = new Set()
    const walk = (file, imported) => {
      const barrel = this.throughBarrel(file, imported)
      if (barrel) {
        reached.add(file)
        for (const [name, targets] of barrel) {
          if (seen.has(`${file}#${name}`)) continue
          seen.add(`${file}#${name}`)
          for (const target of targets) walk(target, [name])
        }
        return
      }
      if (seen.has(`${file}#*`)) return
      seen.add(`${file}#*`)
      reached.add(file)
      for (const entry of this.importsOf(file)) walk(entry.target, entry.reexport ? undefined : entry.named)
    }
    walk(start, undefined)
    this.closures.set(start, reached)
    return reached
  }

  /** The files an import of `names` from `file` lands on: through barrels, the modules that declare the names. */
  landing(file, names, out = new Set(), seen = new Set()) {
    const barrel = this.throughBarrel(file, names)
    if (!barrel) return out.add(file)
    for (const [name, targets] of barrel) {
      if (seen.has(`${file}#${name}`)) continue
      seen.add(`${file}#${name}`)
      for (const target of targets) this.landing(target, [name], out, seen)
    }
    return out
  }

  /** The files that import `file` directly, with named imports from a barrel counted against the declaring module. */
  importers(file) {
    if (this.importerIndex === undefined) {
      this.importerIndex = new Map()
      for (const from of this.files) {
        if (!/\.(ts|tsx|mjs|js)$/.test(from)) continue
        for (const entry of this.importsOf(from)) {
          for (const target of this.landing(entry.target, entry.reexport ? undefined : entry.named)) {
            if (!this.importerIndex.has(target)) this.importerIndex.set(target, new Set())
            this.importerIndex.get(target).add(from)
          }
        }
      }
    }
    return [...(this.importerIndex.get(file) ?? [])]
  }
}

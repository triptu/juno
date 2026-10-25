// The locked versions of the outside packages a build or check imports, so a
// lockfile change keys only what it reaches (scripts/build-inputs.mjs,
// apps/gallery/walk-cache.mjs).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const digest = (value) => createHash('sha256').update(value).digest('hex')

/**
 * The lockfile's settings and the entries for `[importer, name]` pairs and
 * everything they depend on. An unreadable lockfile counts whole.
 */
export function lockedPackages(root, roots) {
  const text = existsSync(join(root, 'bun.lock')) ? readFileSync(join(root, 'bun.lock'), 'utf8') : ''
  let lock
  try { lock = JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')) } catch { return digest(text) }
  const { packages = {}, workspaces: _workspaces, ...settings } = lock
  const picked = new Map()
  const names = (key) => key.split('/').reduce((list, part) => list.at(-1)?.startsWith('@') && !list.at(-1).includes('/') ? [...list.slice(0, -1), `${list.at(-1)}/${part}`] : [...list, part], [])
  const visit = (parent, name) => {
    // Bun keys a nested copy under its dependent: `parent/name`, then each ancestor.
    const chain = names(parent)
    const key = Array.from({ length: chain.length + 1 }, (_, index) => [...chain.slice(0, chain.length - index), name].join('/')).find((candidate) => packages[candidate])
    if (key === undefined || picked.has(key)) return
    picked.set(key, packages[key])
    const info = packages[key][2]
    if (typeof info !== 'object' || info === null) return
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) for (const next of Object.keys(info[field] ?? {})) visit(key, next)
  }
  for (const [importer, name] of roots) visit(importer, name)
  return digest(JSON.stringify([settings, [...picked].toSorted(([a], [b]) => a < b ? -1 : 1)]))
}

/** The package name a bare specifier imports, or undefined for a path, a URL or a `node:` builtin. */
export function packageName(specifier) {
  if (/^[./]|^\w+:/.test(specifier)) return undefined
  return /^(?:@[\w.-]+\/)?[\w.-]+(?=\/|$)/.exec(specifier)?.[0]
}

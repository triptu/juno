#!/usr/bin/env bun
/**
 * Checks the migration ids of `cache.db` and `user.db`
 * (packages/store/src/migrations/<db>/index.ts):
 *
 * - Every id that main does not have is greater than the largest id on
 *   main. The Migrator runs only ids above the newest one a database has
 *   recorded, so a smaller new id would never run on an existing install.
 * - No id appears twice.
 *
 * Main is `origin/main`, or `main` without a remote. Without git or either
 * branch, only the uniqueness check runs. Run by `bun run lint`.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INDEXES = ['packages/store/src/migrations/cache/index.ts', 'packages/store/src/migrations/user/index.ts']
const KEY = /^\s*'(\d{12})_([A-Za-z0-9_]+)'\s*:/gm

/** The `<id>_<name>` keys of a migrations record, in file order. */
const keysOf = (source) => [...source.matchAll(KEY)].map(([, id, name]) => ({ id, name: `${id}_${name}` }))

const git = (args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  return result.error === undefined && result.status === 0 ? result.stdout : undefined
}

const mainRef = ['origin/main', 'main'].find((ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== undefined)

/** The id one minute after `id`, read as `YYYYMMDDHHMM` in UTC. */
const nextMinute = (id) => {
  const [y, mo, d, h, mi] = [id.slice(0, 4), id.slice(4, 6), id.slice(6, 8), id.slice(8, 10), id.slice(10, 12)].map(Number)
  const next = new Date(Date.UTC(y, mo - 1, d, h, mi + 1))
  const pad = (n) => String(n).padStart(2, '0')
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}${pad(next.getUTCHours())}${pad(next.getUTCMinutes())}`
}

const problems = []
for (const path of INDEXES) {
  const current = keysOf(readFileSync(resolve(root, path), 'utf8'))
  const seen = new Map()
  for (const key of current) seen.set(key.id, [...(seen.get(key.id) ?? []), key.name])
  for (const [id, names] of seen) if (names.length > 1) problems.push(`${path}: id ${id} is used by ${names.join(', ')}. Give each migration its own id.`)

  if (mainRef === undefined) continue
  const onMain = git(['show', `${mainRef}:${path}`])
  if (onMain === undefined) continue
  const mainIds = new Set(keysOf(onMain).map((key) => key.id))
  if (mainIds.size === 0) continue
  const mainMax = [...mainIds].toSorted().at(-1)
  const taken = new Set(current.map((key) => key.id))
  let candidate = mainMax
  for (const key of current) {
    if (mainIds.has(key.id) || key.id > mainMax) continue
    do candidate = nextMinute(candidate)
    while (taken.has(candidate))
    taken.add(candidate)
    problems.push(
      `${path}: renumber ${key.name} to ${candidate}${key.name.slice(12)} or later. The largest id on ${mainRef} is ${mainMax}, and the Migrator skips ids at or below the newest one it has recorded, so existing installs would never run it. Rename the file and its key in index.ts.`,
    )
  }
}

if (mainRef === undefined) console.log('check-migration-order: main not found (no git, or no main branch); checked uniqueness only')
if (problems.length > 0) {
  for (const problem of problems) console.error(`check-migration-order: ${problem}`)
  process.exitCode = 1
} else console.log(`Migration order: ok${mainRef === undefined ? '' : ` (against ${mainRef})`}`)

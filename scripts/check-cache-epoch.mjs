#!/usr/bin/env node
/**
 * Checks that `CACHE_RESET_EPOCH` (packages/store/src/migrations/cache/index.ts)
 * matches the newest decision fragment that records it. A change of the
 * epoch deletes every user's cache.db and syncs everything from Slack again,
 * so it needs a fragment in docs/decisions/log/ that says "cache reset epoch
 * N" and why. Run by `bun run lint`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(root, 'packages/store/src/migrations/cache/index.ts'), 'utf8')
const declared = /export const CACHE_RESET_EPOCH = (\d+)\b/.exec(source)
const MARKER = /cache reset epoch (\d+)\b/i

if (declared === null) {
  console.error('check-cache-epoch: CACHE_RESET_EPOCH not found in packages/store/src/migrations/cache/index.ts')
  process.exitCode = 1
} else {
  const epoch = Number(declared[1])
  const directory = resolve(root, 'docs/decisions/log')
  // Fragment names start with their date and time, so name order is time order.
  const recorded = readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .toSorted()
    .flatMap((name) => {
      const match = MARKER.exec(readFileSync(resolve(directory, name), 'utf8'))
      return match === null ? [] : [{ name, epoch: Number(match[1]) }]
    })
  const last = recorded.at(-1)
  if (last === undefined || last.epoch !== epoch) {
    console.error(
      `check-cache-epoch: CACHE_RESET_EPOCH is ${epoch}, but the newest decision fragment that records it ${last === undefined ? 'does not exist' : `(${last.name}) says ${last.epoch}`}.\n` +
        `A new epoch deletes every cache.db and syncs everything again. Prefer a cache migration (packages/store README, "Cache migrations").\n` +
        `If the change truly cannot be migrated, add a fragment in docs/decisions/log/ that says "cache reset epoch ${epoch}" and why.`,
    )
    process.exitCode = 1
  } else console.log(`Cache reset epoch: ${epoch} (${last.name})`)
}

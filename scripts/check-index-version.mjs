#!/usr/bin/env bun
// An unchanged topic_input skips recomputation, so changed rules need a new index version.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ImportGraph } from './import-graph.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const versionFile = 'packages/sync/src/indexVersion.ts'
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const version = source => Number(/export const INDEX_VERSION = (\d+)\b/.exec(source)?.[1])

try {
  let main
  try { main = git('rev-parse', '--verify', 'origin/main') }
  catch { main = git('rev-parse', '--verify', 'main') }
  const base = git('merge-base', main, 'HEAD')
  const before = version(git('show', `${base}:${versionFile}`))
  const after = version(readFileSync(resolve(root, versionFile), 'utf8'))
  if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after)) throw new Error('INDEX_VERSION must be an integer')
  const files = new Set(git('ls-files', '--cached', '--others', '--exclude-standard').split('\n'))
  const graph = new ImportGraph(root, files)
  const inputs = graph.closure('packages/sync/src/reindex.ts')
  const changed = new Set([
    ...git('diff', '--name-only', base, '--').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ])
  const rules = [...inputs].filter(file => file !== versionFile && changed.has(file))
  if (after < before || (rules.length > 0 && after <= before)) {
    throw new Error(`Bump INDEX_VERSION above ${before} in ${versionFile}. Topic index inputs are cached across boots; changes to indexing, previews or their dependencies must invalidate stored rows.\n${rules.join('\n')}`)
  }
  console.log(`Index version: ${after} (${rules.length} changed rule inputs, against ${base.slice(0, 9)})`)
} catch (error) {
  console.error(`check-index-version: ${error.message}`)
  process.exitCode = 1
}

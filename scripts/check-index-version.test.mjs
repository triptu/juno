import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { toolFixture } from './tool-test-fixture.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))
test('index rules and transitive preview changes require a forward version, including uncommitted work', t => {
  const { root, env, write, git } = toolFixture(t)
  mkdirSync(join(root, 'scripts'))
  for (const name of ['check-index-version.mjs', 'import-graph.mjs']) copyFileSync(join(scripts, name), join(root, 'scripts', name))
  const version = 'packages/sync/src/indexVersion.ts'
  const preview = 'packages/richtext/src/preview.ts'
  write(version, 'export const INDEX_VERSION = 7\n')
  write('packages/sync/src/reindex.ts', "import { preview } from '../../richtext/src/preview'\nexport const row = preview()\n")
  write(preview, "export const preview = () => 'old'\n")
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'base')
  git('checkout', '-qb', 'change')
  const check = () => spawnSync(process.execPath, ['scripts/check-index-version.mjs'], { cwd: root, env, encoding: 'utf8' })
  assert.equal(check().status, 0)
  write(preview, "export const preview = () => 'new'\n")
  const stale = check()
  assert.equal(stale.status, 1)
  assert.match(stale.stderr, /Bump INDEX_VERSION above 7/)
  assert.match(stale.stderr, /richtext\/src\/preview.ts/)
  write(version, 'export const INDEX_VERSION = 6\n')
  assert.equal(check().status, 1)
  write(version, 'export const INDEX_VERSION = 8\n')
  assert.equal(check().status, 0)
  git('add', '.')
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'new rule')
  assert.equal(check().status, 0)
  write(version, 'export const INDEX_VERSION = 7\n')
  assert.equal(check().status, 1)
})

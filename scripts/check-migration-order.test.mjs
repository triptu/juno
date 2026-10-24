import { toolFixture } from './tool-test-fixture.mjs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const scripts = dirname(fileURLToPath(import.meta.url))
const CACHE = 'packages/store/src/migrations/cache/index.ts'
const USER = 'packages/store/src/migrations/user/index.ts'

const index = (ids) => `export const migrations = {\n${ids.map((id) => `  '${id}': ${id.slice(13)},`).join('\n')}\n}\n`

/** A repository with the check and both indexes; `main` holds `mainIds` in the cache index. */
function fixture(t, { git: withGit = true } = {}) {
  const { root: dir, env } = toolFixture(t)
  const write = (file, text) => {
    mkdirSync(dirname(resolve(dir, file)), { recursive: true })
    writeFileSync(resolve(dir, file), text)
  }
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  mkdirSync(resolve(dir, 'scripts'))
  copyFileSync(resolve(scripts, 'check-migration-order.mjs'), resolve(dir, 'scripts/check-migration-order.mjs'))
  write(CACHE, index(['202610121200_initial', '202610161000_avatars']))
  write(USER, index(['202610121200_initial']))
  if (withGit) {
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgsign', 'false')
    git('add', '.')
    git('commit', '-q', '-m', 'main')
    git('checkout', '-q', '-b', 'topic')
  }
  const check = () => spawnSync(process.execPath, ['scripts/check-migration-order.mjs'], { cwd: dir, env, encoding: 'utf8' })
  return { write, check }
}

test('migration conflicts get distinct forward ids; correcting ordering and duplicates allows the change', (t) => {
  const { write, check } = fixture(t)
  write(CACHE, index(['202610121200_initial', '202610161000_avatars', '202610160900_late']))
  const result = check()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /cache\/index\.ts: renumber 202610160900_late to 202610161001_late or later\. The largest id on main is 202610161000/)
  write(CACHE, index(['202610121200_initial', '202610161000_avatars', '202610161001_ok', '202610150000_a', '202610150001_b']))
  const late = check()
  assert.equal(late.status, 1)
  assert.match(late.stderr, /202610161002_a/)
  assert.match(late.stderr, /202610161003_b/)
  write(CACHE, index(['202610121200_initial', '202610161000_avatars', '202610161001_ok', '202610161002_a', '202610161003_b']))
  assert.equal(check().status, 0)
  write(USER, index(['202610121200_initial', '202610161100_one', '202610161100_two']))
  assert.equal(check().status, 1)
  write(USER, index(['202610121200_initial', '202610161100_one', '202610161101_two']))
  assert.equal(check().status, 0)
})

test('without git it checks uniqueness only', (t) => {
  const { write, check } = fixture(t, { git: false })
  write(CACHE, index(['202610161000_avatars', '202610121200_late']))
  const result = check()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /checked uniqueness only/)
})

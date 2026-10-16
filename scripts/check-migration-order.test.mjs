import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const scripts = dirname(fileURLToPath(import.meta.url))
const CACHE = 'packages/store/src/migrations/cache/index.ts'
const USER = 'packages/store/src/migrations/user/index.ts'

const index = (ids) => `export const migrations = {\n${ids.map((id) => `  '${id}': ${id.slice(13)},`).join('\n')}\n}\n`

/** A repository with the check and both indexes; `main` holds `mainIds` in the cache index. */
function fixture(t, { git: withGit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'juno-migration-order-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const write = (file, text) => {
    mkdirSync(dirname(resolve(dir, file)), { recursive: true })
    writeFileSync(resolve(dir, file), text)
  }
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
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
  const check = () => spawnSync(process.execPath, ['scripts/check-migration-order.mjs'], { cwd: dir, encoding: 'utf8' })
  return { write, check }
}

test('a new id below the largest id on main fails and names the id to use', (t) => {
  const { write, check } = fixture(t)
  write(CACHE, index(['202610121200_initial', '202610161000_avatars', '202610160900_late']))
  const result = check()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /cache\/index\.ts: renumber 202610160900_late to 202610161001_late or later\. The largest id on main is 202610161000/)
})

test('a new id above the largest id on main passes', (t) => {
  const { write, check } = fixture(t)
  write(CACHE, index(['202610121200_initial', '202610161000_avatars', '202610161100_new']))
  write(USER, index(['202610121200_initial', '202610161100_new']))
  const result = check()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Migration order: ok \(against main\)/)
})

test('two late ids get distinct suggestions past the new ids already in use', (t) => {
  const { write, check } = fixture(t)
  write(CACHE, index(['202610121200_initial', '202610161000_avatars', '202610161001_ok', '202610150000_a', '202610150001_b']))
  const result = check()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /renumber 202610150000_a to 202610161002_a/)
  assert.match(result.stderr, /renumber 202610150001_b to 202610161003_b/)
})

test('a duplicate id fails', (t) => {
  const { write, check } = fixture(t)
  write(USER, index(['202610121200_initial', '202610161100_one', '202610161100_two']))
  const result = check()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /user\/index\.ts: id 202610161100 is used by 202610161100_one, 202610161100_two/)
})

test('without git it checks uniqueness only', (t) => {
  const { write, check } = fixture(t, { git: false })
  write(CACHE, index(['202610161000_avatars', '202610121200_late']))
  const result = check()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /checked uniqueness only/)
})

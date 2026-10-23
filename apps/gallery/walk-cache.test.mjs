import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { walkCache } from './walk-cache.mjs'

function fixture(t) {
  const scratch = '/Volumes/AgentWork/scratch'
  const root = mkdtempSync(join(existsSync(scratch) ? scratch : tmpdir(), 'gallery-cache-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text) }
  write('packages/ui/package.json', JSON.stringify({ name: '@juno/ui', exports: { '.': './src/index.ts' } }))
  write('packages/ui/src/index.ts', "export { Button } from './Button'\nexport { Other } from './Other'")
  write('packages/ui/src/Button.ts', "import { width } from './width'\nexport const Button = width")
  write('packages/ui/src/width.ts', 'export const width = 20')
  write('packages/ui/src/Other.ts', 'export const Other = 2')
  write('packages/views/package.json', JSON.stringify({ name: '@juno/views' }))
  write('packages/views/src/Button.fixtures.ts', "import { Button } from '@juno/ui'\nexport default Button")
  write('packages/views/src/Other.fixtures.ts', "import { Other } from '@juno/ui'\nexport default Other")
  write('packages/views/src/fixtures.ts', "import Button, { secondary } from './Button.fixtures'\nimport Other from './Other.fixtures'\nexport const fixtures = {\n Button,\n Alias: secondary,\n Other,\n}\n")
  write('apps/gallery/src/registry.ts', '// registry')
  const directory = join(root, 'cache')
  const runtime = { playwright: '1', chromium: '2', platform: 'linux', arch: 'x64', viewport: [1280, 800] }
  const cache = (extra = {}) => walkCache({ root, directory, runtime, kind: 'shift', ...extra })
  const route = component => ({ component, route: `${component}/one`, id: 'one', frame: {} })
  return { root, write, directory, runtime, cache, button: route('Button'), alias: route('Alias'), other: route('Other') }
}

test('transitive source and named fixture aliases invalidate only their components', t => {
  const { cache, write, button, alias, other } = fixture(t)
  const before = cache()
  for (const route of [button, alias, other]) before.pass(route)
  write('packages/ui/src/width.ts', 'export const width = 21')
  const after = cache()
  assert.equal(after.passed(button), false)
  assert.equal(after.passed(alias), false)
  assert.equal(after.passed(other), true)
  assert.equal(after.passed({ ...other, id: 'two', route: 'Other/two' }), false)
})

test('dynamic imports, fixtures, fonts and build inputs invalidate successful states', t => {
  const { root, cache, write, button } = fixture(t)
  write('packages/ui/src/Button.ts', "export const Button = () => import('./lazy')")
  write('packages/ui/src/lazy.ts', 'export const size = 1')
  for (const file of ['packages/ui/src/lazy.ts', 'packages/views/src/Button.fixtures.ts', 'packages/tokens/src/global.css', 'packages/tokens/src/font.woff2', 'apps/gallery/dist/assets/font.woff2', 'apps/gallery/vite.config.ts', 'apps/gallery/.env.local', 'bun.lock', 'apps/gallery/shift.spec.ts']) {
    const before = cache()
    before.pass(button)
    let old = ''
    try { old = readFileSync(join(root, file), 'utf8') } catch {}
    write(file, `${old}\n// changed`)
    assert.equal(cache().passed(button), false, file)
  }
})

test('browser, Playwright, OS, architecture, options and guard identity belong to the key', t => {
  const { cache, runtime, button } = fixture(t)
  cache().pass(button)
  for (const field of Object.keys(runtime)) {
    assert.equal(cache({ runtime: { ...runtime, [field]: 'changed' } }).passed(button), false, field)
  }
  assert.equal(cache({ kind: 'ring' }).passed(button), false)
})

test('full runs bypass old passes; failed, incomplete and corrupt records never pass', t => {
  const { cache, directory, button } = fixture(t)
  const check = cache()
  assert.equal(check.passed(button), false)
  check.pass(button)
  assert.equal(cache().passed(button), true)
  const full = cache({ all: true })
  assert.equal(full.passed(button), false)
  full.forget(button)
  assert.equal(cache().passed(button), false)
  full.pass(button)
  assert.equal(cache().passed(button), true)
  writeFileSync(join(directory, check.key(button)), 'partial')
  assert.equal(cache().passed(button), false)
})

test('unknown registrations fail closed to all sources', t => {
  const { cache, write, button } = fixture(t)
  const unknown = { ...button, component: 'Composition', route: 'Composition/one' }
  cache().pass(unknown)
  write('packages/ui/src/Other.ts', 'export const Other = 3')
  assert.equal(cache().passed(unknown), false)
})

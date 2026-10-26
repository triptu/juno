import assert from 'node:assert/strict'
import { cpSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { toolFixture } from './tool-test-fixture.mjs'

function fixture(t) {
  const f = toolFixture(t)
  cpSync(import.meta.dirname, join(f.root, 'scripts'), { recursive: true })
  symlinkSync(resolve(import.meta.dirname, '../node_modules'), join(f.root, 'node_modules'), 'dir')
  f.write('.gitignore', 'node_modules\nhome\ntmp\n.juno-status\n')
  f.write('package.json', JSON.stringify({ workspaces: ['packages/*', 'apps/*'], packageManager: 'bun@1.4.4', devDependencies: { '@informalsystems/quint': '0.33.0' }, scripts: { 'bench:engine': 'bun test test/perf/load.perf.ts', 'test:repo-tools': 'bun test scripts/check-tokens.test.mjs', 'test:runner': 'bun test scripts/remote/runner.test.mjs' } }))
  for (const pkg of ['domain', 'engine', 'ui']) f.write(`packages/${pkg}/package.json`, JSON.stringify({ name: `@juno/${pkg}`, exports: './src/index.ts', scripts: { test: 'bun test' } }))
  f.write('apps/desktop/package.json', '{"scripts":{"test":"bun test"}}')
  f.write('packages/domain/src/index.ts', "export { rule } from './rule.ts'; export { other } from './other.ts'")
  f.write('packages/domain/src/rule.ts', 'export const rule = 1')
  f.write('packages/domain/src/other.ts', 'export const other = 2')
  f.write('packages/domain/test/rule.test.ts', "import { rule } from '@juno/domain'")
  f.write('packages/domain/eval/other.test.ts', "import { other } from '@juno/domain'")
  f.write('packages/domain/test/load.perf.ts', "import { rule } from '@juno/domain'")
  f.write('apps/desktop/src/logging.ts', "import { rule } from '@juno/domain'")
  f.write('apps/desktop/test/logging.test.ts', "import '../src/logging.ts'")
  f.write('packages/engine/src/send/worker.ts', "import { rule } from '@juno/domain'")
  f.write('specs/readstate.qnt', 'module readstate {}')
  f.write('apps/desktop/src/main/index.ts', "import '@juno/domain'; import '../../../../packages/ui/src/Chip.tsx'")
  f.write('packages/ui/src/Chip.tsx', 'export const Chip = 1')
  f.write('packages/ui/src/Other.tsx', 'export const Other = 2')
  f.write('packages/ui/src/Chip.fixture.ts', "import './Chip.tsx'")
  f.write('packages/ui/src/Other.fixture.ts', "import './Other.tsx'")
  f.write('packages/ui/src/fixtures.ts', "import Chip from './Chip.fixture'\nimport Other from './Other.fixture'\nexport const fixtures = {\n  Chip,\n  Other,\n}")
  f.write('apps/gallery/shift.spec.ts', '')
  f.write('apps/desktop/e2e/app.spec.ts', '')
  f.write('apps/desktop/e2e/changed.spec.ts', "import './helper.ts'")
  f.write('apps/desktop/e2e/helper.ts', 'export const helper = 1')
  f.write('apps/desktop/e2e/other.spec.ts', '')
  f.git('init', '-q', '-b', 'main')
  f.git('add', '.')
  f.git('commit', '-qm', 'Fixture')
  const plan = (files, ...args) => {
    const result = spawnSync(process.execPath, ['scripts/affected.mjs', '--plan', '--json', '--local', '--no-cache', '--files', files.join(','), ...args], { cwd: f.root, env: f.env, encoding: 'utf8', timeout: 10_000 })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout).steps
  }
  return { ...f, plan }
}
const items = (steps, suite) => steps.find((step) => step.script === suite)?.items ?? []

test('a changed module selects its consumers through a barrel, while configs broaden and changed tests select themselves', (t) => {
  const { plan } = fixture(t)
  assert.deepEqual(items(plan(['packages/domain/src/rule.ts'], '--batch'), 'test').toSorted(), ['apps/desktop/test/logging.test.ts', 'packages/domain/test/rule.test.ts'])
  // b1c55d3c: main-process tests used to be absent from the batch gate.
  assert.deepEqual(items(plan(['apps/desktop/src/logging.ts'], '--batch'), 'test'), ['apps/desktop/test/logging.test.ts'])
  assert.deepEqual(items(plan(['packages/domain/package.json'], '--batch'), 'test').toSorted(), ['packages/domain/eval/other.test.ts', 'packages/domain/test/rule.test.ts'])
  assert.equal(items(plan(['bun.lock'], '--batch'), 'test').length, 3)
  assert.deepEqual(items(plan(['packages/domain/eval/other.test.ts'], '--batch'), 'test'), ['packages/domain/eval/other.test.ts'])
  assert.deepEqual(items(plan(['packages/domain/test/load.perf.ts'], '--batch'), 'test'), [])
})

test('protocol plans follow specs and transitive outbox inputs independently of app selection', (t) => {
  const { plan } = fixture(t)
  const protocols = (file) => plan([file], '--batch').map((step) => step.script).filter((script) => script.startsWith('specs:'))
  assert.deepEqual(protocols('specs/readstate.qnt'), ['specs:check'])
  assert.deepEqual(protocols('packages/engine/src/send/worker.ts'), ['specs:conformance'])
  assert.deepEqual(protocols('packages/domain/src/rule.ts'), ['specs:conformance'])
  assert.deepEqual(protocols('packages/ui/src/Chip.tsx'), [])
})

test('an app change runs every desktop spec, a spec or helper change runs its own, a zero budget keeps changed components, and tool smoke survives filtering', (t) => {
  const { plan } = fixture(t)
  const app = plan(['packages/ui/src/Chip.tsx', 'apps/desktop/e2e/changed.spec.ts'], '--budget-seconds', '0')
  assert.equal(items(app, 'test:desktop').length, 3)
  assert.deepEqual(items(app, 'test:gallery'), ['Chip'])
  assert.deepEqual(items(plan(['apps/desktop/e2e/helper.ts']), 'test:desktop'), ['apps/desktop/e2e/changed.spec.ts'])
  assert.equal(items(plan(['package.json']), 'test:desktop').length, 3)
  assert.deepEqual(items(plan(['scripts/remote/plan.mjs']), 'test:desktop'), ['apps/desktop/e2e/app.spec.ts'])
  assert.deepEqual(items(plan(['scripts/remote/plan.mjs'], '--batch'), 'test:desktop'), [])
  const deleted = plan(['packages/domain/src/deleted.ts'], '--wide')
  // Every unit file (no --files; the unit step carries only its order seed) and every desktop spec.
  assert.deepEqual(deleted.find((step) => step.script === 'test').args.filter((arg) => !arg.startsWith('--seed=')), [])
  assert.deepEqual(deleted.find((step) => step.script === 'test:desktop').args, [])
})

test('tool plans select the command whose test imports the changed script', (t) => {
  const { plan } = fixture(t)
  const scripts = (file) => plan([file], '--batch').map((step) => step.script)
  assert.ok(scripts('scripts/check-tokens.mjs').includes('test:repo-tools'))
  assert.ok(!scripts('scripts/check-tokens.mjs').includes('test:runner'))
  assert.ok(scripts('scripts/remote/usage.mjs').includes('test:runner'))
  assert.ok(!scripts('scripts/affected.mjs').includes('bench:engine'))
})

test('unit execution runs selected files once, preserves failure, and rejects performance files', (t) => {
  const { root, env, write } = toolFixture(t)
  write('package.json', '{"workspaces":["packages/*"]}')
  write('packages/example/package.json', '{"scripts":{"test":"bun test"}}')
  write('packages/example/test/one.test.ts', "import {test} from 'bun:test'; test('one', () => { console.log('SELECTED ONE') })")
  write('packages/example/test/two.test.ts', "import {test} from 'bun:test'; test('two', () => { throw new Error('UNSELECTED TWO') })")
  write('packages/example/test/load.perf.ts', "throw new Error('PERFORMANCE RAN')")
  const run = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, 'unit.mjs'), ...args], { cwd: root, env: { ...env, JUNO_TEST_WORKERS: '1' }, encoding: 'utf8', timeout: 5000 })
  const chosen = run('--files', 'packages/example/test/one.test.ts', 'packages/example/test/one.test.ts')
  assert.equal(chosen.status, 0, chosen.stderr)
  assert.equal((chosen.stdout.match(/SELECTED ONE/g) ?? []).length, 1)
  assert.doesNotMatch(chosen.stderr, /UNSELECTED TWO/)
  const all = run()
  assert.equal(all.status, 1)
  assert.match(all.stderr, /UNSELECTED TWO/)
  assert.doesNotMatch(all.stderr, /PERFORMANCE RAN/)
  for (const file of ['packages/example/test/load.perf.ts', '../escape.test.ts']) {
    const refused = run('--files', file)
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /Not a unit test/)
  }
})

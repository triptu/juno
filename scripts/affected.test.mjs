// bun run affected's unit test selection, through its real plan (--plan --json) on this repository.
import assert from 'node:assert/strict'
import { unitTestMatcher } from './affected-tests.mjs'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plan = (...args) => {
  const result = spawnSync(process.execPath, ['scripts/affected.mjs', '--plan', '--json', '--no-cache', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
const unitFiles = (result) => result.steps.find((step) => step.script === 'test')?.items ?? []
const tracked = (...patterns) => spawnSync('git', ['ls-files', ...patterns], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter((file) => file && existsSync(join(root, file)))

test('a change to desktop code outside the renderer reaches the desktop unit tests that import it, in the batch gate too', () => {
  // main-rejection-nonfatal (b1c55d3c): the batch gate ran no tests for these.
  for (const args of [[], ['--batch']]) assert.ok(unitFiles(plan(...args, '--files', 'apps/desktop/src/logging.ts')).includes('apps/desktop/test/logging.test.ts'), args.join(' '))
  assert.ok(unitFiles(plan('--files', 'apps/desktop/src/main/processes.ts')).includes('apps/desktop/test/processes.test.ts'))
})

test('every unit test file in apps and packages runs when it changes', () => {
  const tests = tracked('apps/**/*.test.ts', 'packages/**/*.test.ts')
  assert.ok(tests.includes('packages/agent/eval/eval.test.ts'))
  assert.deepEqual(unitFiles(plan('--batch', '--files', tests.join(','))).toSorted(), tests.toSorted())
})

test('a script change runs the root Bun test scripts whose tests import it, and every script test is in one', () => {
  const steps = (file) => plan('--batch', '--files', file).steps.map((step) => step.script)
  assert.ok(steps('scripts/check-tokens.mjs').includes('test:repo-tools'))
  assert.ok(steps('scripts/remote/usage.mjs').includes('test:runner'))
  assert.ok(!steps('scripts/check-tokens.mjs').includes('test:runner'))
  const scripts = Object.values(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts).filter((command) => /\bbun test\b/.test(command)).join(' ')
  for (const file of tracked('scripts/**/*.test.mjs', 'scripts/*.test.mjs')) assert.ok(scripts.includes(file), `${file} is in no root bun test script`)
})

test('unit execution runs every package in one bun test, and selected files alone', async () => {
  const { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { unitCommand } = await import('./unit.mjs')
  const file = 'packages/domain/test/notifications.test.ts'
  const selected = plan('--batch', '--files', file).steps.find((step) => step.script === 'test')
  assert.deepEqual(selected.items, [file])
  assert.deepEqual(selected.args, ['--files', file])
  const dir = mkdtempSync(join(existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork' : tmpdir(), 'juno-unit-commands-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*', 'apps/*'] }))
    const make = (pkg, test, files) => {
      mkdirSync(join(dir, pkg, 'test'), { recursive: true })
      writeFileSync(join(dir, pkg, 'package.json'), JSON.stringify({ scripts: { test } }))
      for (const name of files) writeFileSync(join(dir, pkg, name), '')
    }
    make('packages/fast', 'bun test', ['test/one.test.ts', 'test/two.test.ts', 'test/load.perf.ts'])
    make('apps/app', 'bun test', ['test/three.test.ts'])
    writeFileSync(join(dir, 'apps/app/bunfig.toml'), '[test]\nroot = "test"\n')
    make('packages/none', '', [])
    const timings = join(dir, 'node_modules/.cache/juno/bun-test-timings.json')
    const bun = (workers, ...paths) => ['test', `--parallel=${workers}`, `--timings=${timings}`, '--update-timings', ...paths]
    assert.deepEqual(unitCommand([], dir, { workers: 3 }), bun(3, './apps/app/test', './packages/fast'))
    assert.deepEqual(unitCommand(['--files', 'packages/fast/test/one.test.ts', 'apps/app/test/three.test.ts'], dir, { workers: 3 }), bun(2, './packages/fast/test/one.test.ts', './apps/app/test/three.test.ts'))
    assert.throws(() => unitCommand(['--files', 'packages/fast/test/load.perf.ts'], dir), /Not a unit test/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
  assert.throws(() => unitCommand(['--files'], root), /at least one/)
  assert.throws(() => unitCommand(['--files', 'packages/domain/test/absent.test.ts'], root), /Not a unit test/)
})

test('package configs select the whole package, while lockfile changes select every unit file', () => {
  const own = tracked('packages/domain/**/*.test.ts')
  for (const name of ['package.json', 'tsconfig.json']) {
    const selected = unitFiles(plan('--batch', '--files', `packages/domain/${name}`))
    for (const file of own) assert.ok(selected.includes(file), `${name} must run ${file}`)
  }
  assert.deepEqual(unitFiles(plan('--batch', '--files', 'bun.lock')).toSorted(), tracked('apps/**/*.test.ts', 'packages/**/*.test.ts').toSorted())
})

test('ordinary source changes select only files whose import closure reaches them', async () => {
  const { ImportGraph } = await import('./import-graph.mjs')
  const { unitTestMatcher } = await import('./affected-tests.mjs')
  const files = new Set(tracked('apps', 'packages'))
  const graph = new ImportGraph(root, files)
  const changed = 'packages/domain/src/notifications.ts'
  const expected = [...files].filter(unitTestMatcher(root)).filter((file) => graph.closure(file).has(changed))
  assert.deepEqual(unitFiles(plan('--batch', '--files', changed)).toSorted(), expected.toSorted())
  assert.ok(!expected.includes('packages/domain/test/composer-emoji.test.ts'))
})

test('performance-only files are outside the unit matcher', () => {
  const matches = unitTestMatcher(root)
  for (const file of ['packages/agent/test/activity.perf.ts', 'packages/agent/test/serve/chat-cache.perf.ts', 'packages/engine/test/perf/idle.perf.ts', 'packages/engine/test/conformance/outbox.conformance.ts']) assert.equal(matches(file), false, file)
  assert.ok(matches('packages/agent/test/serve/chat-cache.test.ts'))
})

test('tool changes keep the desktop smoke spec through the final input filter', () => {
  const steps = plan('--files', 'scripts/remote/plan.mjs').steps
  assert.deepEqual(steps.find((step) => step.script === 'test:desktop')?.items, ['apps/desktop/e2e/app.spec.ts'])
  assert.ok(!plan('--batch', '--files', 'scripts/remote/plan.mjs').steps.some((step) => step.script === 'test:desktop'))
})

test('a root config change keeps changed desktop specs and their private helpers mandatory', () => {
  const steps = plan('--budget-seconds', '0', '--files', 'package.json,apps/desktop/e2e/mentions.spec.ts,apps/desktop/e2e/idleJourney.ts').steps
  const desktop = steps.find((step) => step.script === 'test:desktop')?.items ?? []
  assert.ok(desktop.includes('apps/desktop/e2e/mentions.spec.ts'))
  assert.ok(desktop.includes('apps/desktop/e2e/idle-cpu.spec.ts'))
  assert.ok(!desktop.some((file) => file.endsWith('.perf.spec.ts')))
})

test('protocol checks follow spec and outbox inputs, including transitive dependencies', () => {
  const scripts = (file) => plan('--batch', '--files', file).steps.map((step) => step.script)
  assert.ok(scripts('specs/readstate.qnt').includes('specs:check'))
  assert.ok(!scripts('specs/readstate.qnt').includes('specs:conformance'))
  assert.ok(scripts('packages/engine/src/send/worker.ts').includes('specs:conformance'))
  assert.ok(!scripts('packages/engine/src/send/worker.ts').includes('specs:check'))
  assert.ok(scripts('packages/sync/src/followFence.ts').includes('specs:conformance'))
  assert.ok(!scripts('packages/sync/src/followFence.ts').includes('specs:check'))
  assert.ok(!scripts('packages/views/src/Sidebar.tsx').includes('specs:check'))
  assert.ok(!scripts('packages/views/src/Sidebar.tsx').includes('specs:conformance'))
})

test('a repair conservatively reruns app suites when a deleted source cannot be followed in the current graph', () => {
  const result = plan('--wide', '--graph', '--files', 'packages/domain/src/deleted-rule.ts')
  assert.ok(result.steps.some((step) => step.script === 'test' && step.args.length === 0))
  assert.ok(result.steps.some((step) => step.script === 'test:desktop' && step.args.length === 0))
})

test('Bun packages select test and eval files, not perf files', async (t) => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { scratchFolder } = await import('./worktree-folder.mjs')
  const fixture = mkdtempSync(join(scratchFolder(), 'affected-bun-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(join(fixture, 'packages/example'), { recursive: true })
  writeFileSync(join(fixture, 'packages/example/package.json'), '{"scripts":{"test":"bun test"}}')
  const matches = unitTestMatcher(fixture)
  assert.ok(matches('packages/example/test/domain.test.ts'))
  assert.ok(matches('packages/example/eval/behavior.test.ts'))
  assert.ok(!matches('packages/example/test/domain.perf.ts'))
})

test('graph fallback and gallery components respect time budgets while changed files stay required; repairs remain uncapped', () => {
  const files = 'packages/ui/src/Chip.tsx,apps/desktop/e2e/mentions.spec.ts'
  const narrow = plan('--graph', '--budget-seconds', '0', '--files', files).steps
  assert.deepEqual(narrow.find((step) => step.script === 'test:desktop').items, ['apps/desktop/e2e/mentions.spec.ts'])
  assert.deepEqual(narrow.find((step) => step.script === 'test:gallery').items.filter((file) => !file.startsWith('apps/')), ['Chip'])
  const wide = plan('--wide', '--graph', '--budget-seconds', '0', '--files', files).steps
  assert.ok(wide.find((step) => step.script === 'test:desktop').items.length > 10)
  assert.ok(wide.find((step) => step.script === 'test:gallery').items.filter((file) => !file.startsWith('apps/')).length > 10)
})

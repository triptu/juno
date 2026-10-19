// pnpm affected's unit test selection, through its real plan (--plan --json) on this repository.
import assert from 'node:assert/strict'
import { unitTestMatcher } from './affected-tests.mjs'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
const tracked = (...patterns) => spawnSync('git', ['ls-files', ...patterns], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)

test('a change to desktop code outside the renderer reaches the desktop unit tests that import it, in the batch gate too', () => {
  // main-rejection-nonfatal (b1c55d3c): the batch gate ran no tests for these.
  for (const args of [[], ['--batch']]) assert.ok(unitFiles(plan(...args, '--files', 'apps/desktop/src/processLog.ts')).includes('apps/desktop/test/processLog.test.ts'), args.join(' '))
  assert.ok(unitFiles(plan('--files', 'apps/desktop/src/main/processes.ts')).includes('apps/desktop/test/processes.test.ts'))
})

test('every vitest file in apps and packages runs when it changes', () => {
  const tests = tracked('apps/**/*.test.ts', 'packages/**/*.test.ts')
  assert.ok(tests.includes('packages/agent/eval/eval.test.ts'))
  assert.deepEqual(unitFiles(plan('--batch', '--files', tests.join(','))).toSorted(), tests.toSorted())
})

test('a script change runs the root Node test scripts whose tests import it, and every script test is in one', () => {
  const steps = (file) => plan('--batch', '--files', file).steps.map((step) => step.script)
  assert.ok(steps('scripts/check-tokens.mjs').includes('test:repo-tools'))
  assert.ok(steps('scripts/remote/usage.mjs').includes('test:remote-pool'))
  assert.ok(!steps('scripts/check-tokens.mjs').includes('test:remote-pool'))
  const scripts = Object.values(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts).filter((command) => /\bnode --test\b/.test(command)).join(' ')
  for (const file of tracked('scripts/**/*.test.mjs', 'scripts/*.test.mjs')) assert.ok(scripts.includes(file), `${file} is in no root node --test script`)
})

test('unit execution keeps package identity and starts no unrelated packages', async () => {
  const { unitCommands } = await import('./unit.mjs')
  const file = 'packages/domain/test/notifications.test.ts'
  const selected = plan('--batch', '--files', file).steps.find((step) => step.script === 'test')
  assert.deepEqual(selected.items, [file])
  assert.deepEqual(selected.args, ['--files', file])
  assert.deepEqual(unitCommands(selected.args, root, 2), [['--dir', 'packages/domain', 'test', join(root, file)]])
  const other = 'packages/engine/test/notifications.test.ts'
  assert.deepEqual(unitCommands(['--files', file, other], root, 2).map((args) => args[1]), ['packages/domain', 'packages/engine'])
  assert.throws(() => unitCommands(['--files'], root, 2), /at least one/)
  assert.throws(() => unitCommands(['--files', 'packages/domain/test/absent.test.ts'], root, 2), /Not a unit test/)
})

test('package configs select the whole package, while lockfile changes select every unit file', () => {
  const own = tracked('packages/domain/**/*.test.ts')
  for (const name of ['package.json', 'vitest.config.ts', 'tsconfig.json']) {
    const selected = unitFiles(plan('--batch', '--files', `packages/domain/${name}`))
    for (const file of own) assert.ok(selected.includes(file), `${name} must run ${file}`)
  }
  assert.deepEqual(unitFiles(plan('--batch', '--files', 'pnpm-lock.yaml')).toSorted(), tracked('apps/**/*.test.ts', 'packages/**/*.test.ts').toSorted())
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
  for (const file of ['packages/agent/test/activity.perf.ts', 'packages/agent/test/serve/chat-cache.perf.ts', 'packages/engine/test/idle.perf.ts']) assert.equal(matches(file), false, file)
  assert.ok(matches('packages/agent/test/serve/chat-cache-budget.test.ts'))
})

test('selected unit files exclude nested namesakes that Vitest substring filters would also run', async () => {
  const { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { unitCommands } = await import('./unit.mjs')
  const dir = mkdtempSync(join(existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork' : tmpdir(), 'juno-unit-selection-'))
  try {
    mkdirSync(join(dir, 'packages/example/test/nested/test'), { recursive: true })
    writeFileSync(join(dir, 'packages/example/package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }))
    const file = 'packages/example/test/one.test.ts'
    writeFileSync(join(dir, file), '')
    writeFileSync(join(dir, 'packages/example/test/nested/test/one.test.ts'), '')
    assert.deepEqual(unitCommands(['--files', file], dir, 2), [
      ['--dir', 'packages/example', 'test', join(dir, file), '--exclude', 'test/nested/test/one.test.ts'],
    ])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('tool changes keep the desktop smoke spec through the final input filter', () => {
  const steps = plan('--files', 'scripts/remote/plan.mjs').steps
  assert.deepEqual(steps.find((step) => step.script === 'test:desktop')?.items, ['apps/desktop/e2e/app.spec.ts'])
  assert.ok(!plan('--batch', '--files', 'scripts/remote/plan.mjs').steps.some((step) => step.script === 'test:desktop'))
})

test('a root config change keeps changed desktop specs and their private helpers mandatory', () => {
  const steps = plan('--max-specs', '0', '--files', 'package.json,apps/desktop/e2e/mentions.spec.ts,apps/desktop/e2e/idleJourney.ts').steps
  const desktop = steps.find((step) => step.script === 'test:desktop')?.items ?? []
  assert.ok(desktop.includes('apps/desktop/e2e/mentions.spec.ts'))
  assert.ok(desktop.includes('apps/desktop/e2e/idle-cpu.spec.ts'))
  assert.ok(!desktop.some((file) => file.endsWith('.perf.spec.ts')))
})

// pnpm affected's unit test selection, through its real plan (--plan --json) on this repository.
import assert from 'node:assert/strict'
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

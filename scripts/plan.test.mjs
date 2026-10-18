import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lanes, parsePlan, sideBySide } from './plan.mjs'

test('a plan splits on + and reads KEY=VALUE before each script', () => {
  const steps = parsePlan(['test', '--passWithNoTests', 'a.test.ts', '+', 'GALLERY_SHIFT_ONLY=Chip,Tab', 'test:gallery', '+', 'test:desktop', 'e2e/topic.spec.ts', 'X=1'])
  assert.deepEqual(steps, [
    { env: {}, script: 'test', args: ['--passWithNoTests', 'a.test.ts'] },
    { env: { GALLERY_SHIFT_ONLY: 'Chip,Tab' }, script: 'test:gallery', args: [] },
    { env: {}, script: 'test:desktop', args: ['e2e/topic.spec.ts', 'X=1'] },
  ])
  assert.throws(() => parsePlan(['test', '+']), /needs a script/)
  assert.throws(() => parsePlan(['test:plan']), /cannot contain/)
})

test('app, unit, and spec suites run in separate lanes', () => {
  const steps = parsePlan(['test', '+', 'specs:check', '+', 'test:gallery', '+', 'test:desktop'])
  assert.deepEqual(lanes(steps, false).map((lane) => lane.map((step) => step.script)), [['test:gallery', 'test:desktop'], ['test'], ['specs:check']])
  assert.deepEqual(lanes(steps, true).map((lane) => lane.map((step) => step.script)), [['test', 'specs:check', 'test:gallery', 'test:desktop']])
  assert.equal(lanes(parsePlan(['test']), false).length, 1)
})

test('lanes side by side share an 8-core machine without queueing on it', () => {
  assert.deepEqual(sideBySide(8), {
    app: { JUNO_E2E_WORKERS: '4', GALLERY_WORKERS: '6', GALLERY_SHIFT_PARTS: '6' },
    rest: { JUNO_VITEST_WORKERS: '2', JUNO_TEST_PACKAGE_JOBS: '1' },
    specs: { SPECS_JOBS: '2', SPECS_APALACHE: '1' },
  })
  assert.equal(sideBySide(2).app.JUNO_E2E_WORKERS, '2')
})

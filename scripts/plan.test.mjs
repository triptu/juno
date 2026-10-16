import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lanes, parsePlan } from './plan.mjs'

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

test('app suites share one lane and the other suites run beside them', () => {
  const steps = parsePlan(['test', '+', 'specs:check', '+', 'test:gallery', '+', 'test:desktop'])
  assert.deepEqual(lanes(steps, false).map((lane) => lane.map((step) => step.script)), [['test:gallery', 'test:desktop'], ['test', 'specs:check']])
  assert.deepEqual(lanes(steps, true).map((lane) => lane.map((step) => step.script)), [['test', 'specs:check', 'test:gallery', 'test:desktop']])
  assert.equal(lanes(parsePlan(['test']), false).length, 1)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evidenceCommit, nightlyReach } from './nightly-reach.mjs'

const SPEC = 'apps/desktop/e2e/huddle.spec.ts'
const DOM = 'apps/desktop/dom/huddle.test.ts'
// A line of history: a is the oldest, d the newest.
const order = ['a', 'b', 'c', 'd']
const isAncestor = (ancestor, descendant) => order.indexOf(ancestor) <= order.indexOf(descendant)
const distance = (from, to) => order.indexOf(to) - order.indexOf(from)
const passed = (suite, command, extra = {}) => ({ suite, code: 0, command, ...extra })
const run = (commit, suites, extra = {}) => ({ commit, finishedAt: `2026-10-25T0${order.indexOf(commit)}:00:00Z`, suites, ...extra })

test('what counts as a passing run of a file’s nightly tests', () => {
  const skipped = run('a', [passed('test:browser', ['JUNO_SKIP_TAGS=@nightly', 'test:browser']), passed('test:electron', ['JUNO_SKIP_TAGS=@nightly', 'test:electron']), passed('test:dom', ['JUNO_SKIP_TAGS=@nightly', 'test:dom', '--seed=1'])])
  assert.equal(evidenceCommit(skipped, SPEC, isAncestor), undefined)
  assert.equal(evidenceCommit(skipped, DOM, isAncestor), undefined)

  // A nightly run, or one from before the tier, ran every lane whole.
  const whole = run('b', [passed('test:browser', ['JUNO_COVERAGE=1', 'test:browser']), passed('test:electron', ['test:electron']), passed('test:dom', ['test:dom', '--seed=1'])])
  assert.equal(evidenceCommit(whole, SPEC, isAncestor), 'b')
  assert.equal(evidenceCommit(whole, DOM, isAncestor), 'b')
  assert.equal(evidenceCommit({ ...whole, smoke: true }, SPEC, isAncestor), undefined)
  // Both desktop lanes must pass.
  assert.equal(evidenceCommit(run('b', [whole.suites[0], { ...whole.suites[1], code: 1 }]), SPEC, isAncestor), undefined)

  // A release's test:nightly covers the files it named; a reused lane counts at the run it came from.
  const reach = run('c', [passed('test:nightly', ['test:nightly', SPEC])])
  assert.equal(evidenceCommit(reach, SPEC, isAncestor), 'c')
  assert.equal(evidenceCommit(reach, DOM, isAncestor), undefined)
  const repaired = run('d', [passed('test:browser', ['test:browser'], { reusedFrom: { commit: 'b' } }), passed('test:electron', ['test:electron'])])
  assert.equal(evidenceCommit(repaired, SPEC, isAncestor), 'b')
})

test('a file runs again only when the change since its nearest pass reaches it', () => {
  const records = [
    run('a', [passed('test:nightly', ['test:nightly'])]),
    run('b', [passed('test:nightly', ['test:nightly', SPEC])]),
  ]
  const asked = []
  const reach = (reachedFiles) => nightlyReach({
    files: [SPEC, DOM, 'apps/desktop/e2e/stick-bottom.spec.ts'], commit: 'd', records, isAncestor, distance,
    reached: (base) => { asked.push(base); return new Set(reachedFiles[base]) },
  })
  const plan = reach({ a: [DOM], b: [] })
  assert.deepEqual(plan.map((item) => [item.file, item.evidence?.commit, item.run]), [[SPEC, 'b', false], [DOM, 'a', true], ['apps/desktop/e2e/stick-bottom.spec.ts', 'a', false]])
  // One plan per evidence commit.
  assert.deepEqual(asked.toSorted(), ['a', 'b'])
  assert.deepEqual(nightlyReach({ files: [SPEC], commit: 'd', records: [], isAncestor, distance, reached: () => new Set() }).map((item) => item.run), [true])
  // A pass at a commit that is not an ancestor is no evidence.
  assert.deepEqual(nightlyReach({ files: [SPEC], commit: 'b', records: [run('c', [passed('test:nightly', ['test:nightly'])])], isAncestor, distance, reached: () => new Set() }).map((item) => item.run), [true])
})

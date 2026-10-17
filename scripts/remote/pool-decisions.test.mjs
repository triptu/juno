import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeOutage, attemptSettled, capacity, describeOutage, machinesToDestroy, mayPass, noteCall, parseDuration, pendingVcpu, requestCap } from './pool-decisions.mjs'

const now = 10_000_000
const instance = (id, labels = {}, age = 600_000) => ({ cluster_id: id, created_at: new Date(now - age).toISOString(), labels: { 'juno-remote': '1', ...labels }, shape: { virtual_cpu: 4 } })
const state = (id, extra = {}) => ({ id, created: now - 600_000, lastUsed: now, ...extra })
const decide = (extra) => machinesToDestroy({ instances: [], states: [], pending: [], owner: 'ours', now, idleMs: 300_000, lifetimeMs: 10_800_000, ...extra })

test('reclaims old orphans from this pool and legacy machines only', () => {
  assert.deepEqual(decide({ instances: [instance('ours', { 'juno-pool': 'ours' }), instance('legacy'), instance('foreign', { 'juno-pool': 'theirs' }), instance('unrelated', { 'juno-remote': '0' }), instance('young', {}, 1000), { ...instance('unknown-age'), created_at: undefined }] }), ['ours', 'legacy'])
})
test('protects live state even when expired, abandoned or destroying', () => {
  assert.deepEqual(decide({ states: [state('busy', { live: true, destroying: true, abandoned: true, created: 0 })], instances: [instance('busy')] }), [])
})
test('protects live pending creates and reclaims known failed attempts immediately', () => {
  const instances = [instance('pending', { 'juno-create': 'attempt' })]
  assert.deepEqual(decide({ instances, pending: [{ token: 'attempt', live: true }] }), [])
  assert.deepEqual(decide({ instances: [instance('pending', { 'juno-create': 'attempt' }, 1000)], pending: [{ token: 'attempt', live: false }] }), ['pending'])
})
test('retries failed destroys and reclaims dead owners, idle and expired machines', () => {
  assert.deepEqual(decide({ states: [state('failed', { destroying: true }), state('dead', { abandoned: true }), state('idle', { lastUsed: 0 }), state('expired', { created: now - 10_800_000 }), state('warm')] }), ['failed', 'dead', 'idle', 'expired'])
})
test('kept machines remain tracked until expiry', () => {
  assert.deepEqual(decide({ instances: [instance('kept')], states: [state('kept', { kept: true, lastUsed: 0 }), state('expired-kept', { kept: true, created: now - 10_800_000 })] }), ['expired-kept'])
})
test('capacity counts the whole workspace, without counting local state twice', () => {
  assert.deepEqual(capacity([instance('tracked'), instance('orphan'), instance('other', { 'juno-remote': '0' })], [state('tracked'), state('new', { machine: 'linux/amd64:2x4' })]), { tracked: 6, untracked: 8 })
})

test('pending capacity is reserved until visible, without double counting', () => {
  const pending = [{ token: 'a', machine: 'linux/amd64:8x16' }, { token: 'b', machine: 'linux/amd64:4x8' }]
  assert.equal(pendingVcpu([], pending), 12)
  assert.equal(pendingVcpu([instance('created', { 'juno-create': 'a' })], pending), 4)
})
test('zero idle window still protects live and kept machines', () => {
  assert.deepEqual(decide({ idleMs: 0, states: [state('idle'), state('live', { live: true }), state('kept', { kept: true })] }), ['idle'])
})

test('each release can set its idle window independently of the watcher', () => {
  assert.deepEqual(decide({ idleMs: 60_000, states: [state('short', { idleMs: 1000, lastUsed: now - 2000 }), state('long', { idleMs: 300_000, lastUsed: now - 120_000 })] }), ['short'])
})

test('a request that does not fit lets later ones use free cores until it has waited two minutes', () => {
  assert.equal(mayPass([], now, 120_000), true)
  assert.equal(mayPass([{ created: now - 60_000 }], now, 120_000), true)
  assert.equal(mayPass([{ created: now - 60_000 }, { created: now - 120_000 }], now, 120_000), false)
  assert.equal(mayPass([{ created: now }], now, 0), false)
})

test("Namespace's idle image builders do not count against the cap", () => {
  assert.deepEqual(capacity([instance('tracked'), { cluster_id: 'builder', labels: { 'nsc.purpose': 'builder' }, shape: { virtual_cpu: 16 } }], [state('tracked')]), { tracked: 4, untracked: 0 })
})

test("requests are admitted against the admitter's cap unless explicitly lowered", () => {
  // Clients before 10-17 always sent 24, their default.
  assert.equal(requestCap({ cap: 24 }, 48), 48)
  assert.equal(requestCap({ cap: 16 }, 48), 16)
  assert.equal(requestCap({ cap: 48, capSet: false }, 48), 48)
  assert.equal(requestCap({ cap: 32, capSet: true }, 48), 32)
  assert.equal(requestCap({ cap: 64, capSet: true }, 48), 48)
  assert.equal(requestCap({ cap: 64, capSet: true }, 64), 64)
})

test('outage waits read as minutes, seconds or hours', () => {
  assert.equal(parseDuration(undefined), undefined)
  assert.equal(parseDuration(''), undefined)
  assert.equal(parseDuration('10m'), 600_000)
  assert.equal(parseDuration('10'), 600_000)
  assert.equal(parseDuration('90s'), 90_000)
  assert.equal(parseDuration('1h'), 3_600_000)
  assert.equal(parseDuration('0'), 0)
  assert.throws(() => parseDuration('soon'), /not a duration/)
})

test('an outage is reported only after calls have failed for a few minutes, and ends with a success', () => {
  const minute = 60_000
  let outage
  for (let i = 0; i < 14; i++) outage = noteCall(outage, { call: 'list', ok: false, error: 'nsc list failed: spawnSync nsc ETIMEDOUT', now: now + i * 20_000 })
  outage = noteCall(outage, { call: 'create', ok: false, error: 'nsc create failed:\nEnsureKubernetesCluster: 504 Gateway Timeout', now: now + 4 * minute })
  assert.equal(activeOutage(outage, now + 2 * minute, 3 * minute), undefined)
  const active = activeOutage(outage, now + 5 * minute, 3 * minute)
  assert.equal(active.since, now)
  // One create failure is not yet an outage of creates.
  assert.deepEqual(active.calls.map(([call]) => call), ['list'])
  assert.match(describeOutage(active), /^Namespace unreachable since \d\d:\d\d \(nsc list timed out 14 times; last: nsc list failed: spawnSync nsc ETIMEDOUT\)$/)
  outage = noteCall(outage, { call: 'create', ok: false, error: 'rpc error: code = Unavailable', now: now + 8 * minute })
  assert.match(describeOutage(activeOutage(outage, now + 8 * minute, 3 * minute)), /nsc list timed out 14 times, nsc create timed out 1 time, nsc create failed 1 time; last: rpc error: code = Unavailable\)$/)
  outage = noteCall(outage, { call: 'list', ok: true, now: now + 9 * minute })
  assert.deepEqual(activeOutage(outage, now + 9 * minute, 3 * minute).calls.map(([call]) => call), ['create'])
  assert.equal(noteCall(outage, { call: 'create', ok: true, now: now + 10 * minute }), undefined)
})

test('a create that did not finish is remembered until an inventory after it settles it', () => {
  const grace = 300_000
  const failed = { failed: true, failedAt: now, created: now - 600_000 }
  const settled = (entry, extra) => attemptSettled({ entry, observed: false, present: false, inventoryStartedAt: now + grace + 1, now: now + grace + 1, graceMs: grace, ...extra })
  assert.equal(settled({ ...failed, live: true }), false)
  // Seen in the workspace, then destroyed.
  assert.equal(settled(failed, { observed: true, now: now + 1, inventoryStartedAt: now + 1 }), true)
  assert.equal(settled(failed, { present: true }), false)
  // Unseen for the grace period, by an inventory taken after the failure.
  assert.equal(settled(failed, { now: now + grace - 1 }), false)
  assert.equal(settled(failed), true)
  // Hours of failed listings: the last good inventory predates the failure.
  assert.equal(settled(failed, { inventoryStartedAt: now - 1, now: now + 7_200_000 }), false)
  // Records from before failedAt existed age from their reservation.
  assert.equal(settled({ failed: true, created: now }), true)
})

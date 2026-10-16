import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capacity, machinesToDestroy, pendingVcpu } from './pool-decisions.mjs'

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

test("Namespace's idle image builders do not count against the cap", () => {
  assert.deepEqual(capacity([instance('tracked'), { cluster_id: 'builder', labels: { 'nsc.purpose': 'builder' }, shape: { virtual_cpu: 16 } }], [state('tracked')]), { tracked: 4, untracked: 0 })
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capacity, machinesToDestroy } from './pool-decisions.mjs'

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
test('protects live pending creates, but reclaims dead attempts after grace', () => {
  const instances = [instance('pending', { 'juno-create': 'attempt' })]
  assert.deepEqual(decide({ instances, pending: [{ token: 'attempt', live: true }] }), [])
  assert.deepEqual(decide({ instances, pending: [{ token: 'attempt', live: false }] }), ['pending'])
})
test('retries failed destroys and reclaims dead owners, idle and expired machines', () => {
  assert.deepEqual(decide({ states: [state('failed', { destroying: true }), state('dead', { abandoned: true }), state('idle', { lastUsed: 0 }), state('expired', { created: now - 10_800_000 }), state('warm')] }), ['failed', 'dead', 'idle', 'expired'])
})
test('kept machines remain tracked until expiry', () => {
  assert.deepEqual(decide({ instances: [instance('kept')], states: [state('kept', { kept: true, lastUsed: 0 }), state('expired-kept', { kept: true, created: now - 10_800_000 })] }), ['expired-kept'])
})
test('capacity counts the whole workspace, without counting local state twice', () => {
  assert.deepEqual(capacity([instance('tracked'), instance('orphan'), instance('other', { 'juno-remote': '0' })], [state('tracked'), state('gone')]), { tracked: 4, untracked: 8 })
})

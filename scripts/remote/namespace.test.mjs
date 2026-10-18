import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createWithStore, namespaceStoreVolume } from './namespace.mjs'

test('Namespace uses a stable workspace cache tag across lockfiles, with an explicit cold-store option', () => {
  assert.deepEqual(namespaceStoreVolume({}), ['--volume', 'cache:juno-workspace-v1:/var/cache/juno-runner:4gb'])
  assert.deepEqual(namespaceStoreVolume({ JUNO_REMOTE_STORE_CACHE: 'off' }), [])
  assert.deepEqual(namespaceStoreVolume({ JUNO_REMOTE_STORE_TAG: 'measurement' }), ['--volume', 'cache:measurement:/var/cache/juno-runner:4gb'])
  assert.throws(() => namespaceStoreVolume({ JUNO_REMOTE_STORE_TAG: 'bad:tag' }))
})

test('an unavailable cache volume falls back once, without masking other create failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'juno-namespace-store-'))
  const cidfile = join(dir, 'id')
  const calls = [], logs = []
  const unavailable = new Error('cache volumes are not supported on this plan')
  const args = ['create', '--cidfile', cidfile]
  try {
    createWithStore(args, cidfile, (line) => logs.push(line), { env: {}, run: (call) => { calls.push(call); if (calls.length === 1) throw unavailable } })
    assert.equal(calls.length, 2)
    assert(calls[0].includes('--volume'))
    assert.deepEqual(calls[1], args)
    assert.match(logs[0], /using the machine disk/)
    for (const message of ['authentication failed', 'create timed out', 'ResourceExhausted: no free cores', 'cache volume provisioning timed out on this plan']) {
      let count = 0
      assert.throws(() => createWithStore(args, cidfile, assert.fail, { env: {}, run: () => { count++; throw new Error(message) } }), { message })
      assert.equal(count, 1)
    }
    writeFileSync(cidfile, 'allocated')
    assert.throws(() => createWithStore(args, cidfile, assert.fail, { env: {}, run: () => { throw unavailable } }), unavailable)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

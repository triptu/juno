import { describe, expect, it } from 'vitest'
import { INITIAL_SNAPSHOT, patchAttendee, presence, startCall } from '../src/snapshot.ts'
import { share, SnapshotStore } from '../src/store.ts'

const ALICE = 'T0123456789-R0123456789-U0AAAAAAAAA'
const BEN = 'T0123456789-R0123456789-U0BBBBBBBBB'

function storeWithTwo() {
  const store = new SnapshotStore(INITIAL_SNAPSHOT)
  store.update(startCall('self'))
  store.update(presence('a', true, ALICE))
  store.update(presence('b', true, BEN))
  return store
}

describe('snapshot identity', () => {
  it('keeps the same snapshot, and tells nobody, when a change changes nothing', () => {
    const store = storeWithTwo()
    const before = store.getSnapshot()
    let calls = 0
    store.subscribe(() => calls++)
    store.update((s) => ({ ...s, remotes: s.remotes.map((r) => ({ ...r })) }))
    store.update(patchAttendee('a', { muted: false }))
    store.update(presence('a', true, ALICE))
    expect(store.getSnapshot()).toBe(before)
    expect(calls).toBe(0)
  })

  it('makes a new snapshot when something changes, and keeps what did not change', () => {
    const store = storeWithTwo()
    const before = store.getSnapshot()
    store.update(patchAttendee('a', { muted: true }))
    const after = store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.remotes[0]).toMatchObject({ attendeeId: 'a', muted: true })
    expect(after.remotes[1]).toBe(before.remotes[1])
    expect(after.devices).toBe(before.devices)
    expect(after.connection).toBe(before.connection)
  })

  it('shares equal parts of plain data', () => {
    const prev = { a: [1, { b: 2 }], c: { d: 'x' } }
    expect(share(prev, { a: [1, { b: 2 }], c: { d: 'x' } })).toBe(prev)
    const next = share(prev, { a: [1, { b: 3 }], c: { d: 'x' } })
    expect(next).toEqual({ a: [1, { b: 3 }], c: { d: 'x' } })
    expect(next.c).toBe(prev.c)
    expect(share(prev, { a: [1], c: { d: 'x' } })).toEqual({ a: [1], c: { d: 'x' } })
  })
})

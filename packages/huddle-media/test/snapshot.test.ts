import { describe, expect, it } from 'vitest'
import { INITIAL_SNAPSHOT, patchAttendee, presence, setConnection, setLocalShare, shareReady, startCall } from '../src/snapshot.ts'
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

describe('screen shares', () => {
  it('lists others\' shares in the order they started, with their owners', () => {
    const store = storeWithTwo()
    store.update(presence('b#content', true, `${BEN}#content`))
    store.update(presence('a#content', true, ''))
    expect(store.getSnapshot().shares).toEqual([
      { attendeeId: 'b#content', userId: 'U0BBBBBBBBB', ready: false },
      // No user in its own ExternalUserId: the owner's attendee names them.
      { attendeeId: 'a#content', userId: 'U0AAAAAAAAA', ready: false },
    ])
    expect(store.getSnapshot().remotes).toHaveLength(2)
  })

  it('names a share\'s owner once their attendee arrives after it', () => {
    const store = new SnapshotStore(INITIAL_SNAPSHOT)
    store.update(startCall('self'))
    store.update(presence('a#content', true, ''))
    expect(store.getSnapshot().shares[0]?.userId).toBeUndefined()
    store.update(presence('a', true, ALICE))
    expect(store.getSnapshot().shares[0]?.userId).toBe('U0AAAAAAAAA')
  })

  it('never lists the user\'s own share', () => {
    const store = storeWithTwo()
    store.update(presence('self#content', true, ''))
    expect(store.getSnapshot().shares).toEqual([])
  })

  it('keeps a share ready until its attendee leaves', () => {
    const store = storeWithTwo()
    store.update(presence('a#content', true, `${ALICE}#content`))
    store.update(shareReady('a#content', true))
    store.update(presence('a#content', true, `${ALICE}#content`))
    expect(store.getSnapshot().shares[0]?.ready).toBe(true)
    store.update(presence('a#content', false, ''))
    expect(store.getSnapshot().shares).toEqual([])
  })
})

describe('the user\'s own share', () => {
  const window = { sourceId: 'window:7:0', kind: 'window', name: 'Q4 roadmap' } as const

  it('tells two ends alike apart, so each can say why', () => {
    const store = storeWithTwo()
    store.update(setLocalShare({ ...window, live: true }))
    store.update(setLocalShare(undefined, { kind: 'window', reason: 'source-ended' }))
    const first = store.getSnapshot().shareEnded
    store.update(setLocalShare({ ...window, live: true }))
    store.update(setLocalShare(undefined, { kind: 'window', reason: 'source-ended' }))
    expect(store.getSnapshot().shareEnded).not.toBe(first)
    expect(store.getSnapshot().shareEnded?.seq).toBe((first?.seq ?? 0) + 1)
  })

  it('goes with its call, and the next call starts with no share', () => {
    const store = storeWithTwo()
    store.update(setLocalShare({ ...window, live: true }))
    store.update(setConnection({ state: 'ended', reason: 'left', attendeeId: 'self', code: 'Left' }))
    expect(store.getSnapshot().localShare).toBeUndefined()
    expect(store.getSnapshot().shareEnded).toBeUndefined()
    store.update(startCall('self-2'))
    expect(store.getSnapshot().localShare).toBeUndefined()
  })
})

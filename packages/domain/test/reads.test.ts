import { describe, expect, it } from 'vitest'
import {
  acknowledgeLocalWrite,
  emptyReadState,
  markReadLocally,
  markUnreadLocally,
  observeServerRead,
  rejectLocalWrite,
  tsBefore,
  type ReadState,
  type Ts,
} from '../src/index'
import { HOUR, NOW, ts } from './fixtures'

// Slack's clock for events and Juno's clock for pages are separate; the times here only order each among itself.
const at = (minutes: number) => ts(NOW + minutes * 60_000)
const pointer = { old: ts(NOW - 3 * HOUR), mid: ts(NOW - 2 * HOUR), latest: ts(NOW - HOUR) }

const event = (lastReadTs: Ts, eventTs: Ts, observedAt: Ts = eventTs) => ({ kind: 'event', lastReadTs, eventTs, observedAt }) as const
const page = (lastReadTs: Ts, requestedAt: Ts) => ({ kind: 'page', lastReadTs, requestedAt }) as const

/** A topic Juno has seen once, from a page at minute 0, with Slack's pointer `mid`. */
const settled: ReadState = observeServerRead(emptyReadState, page(pointer.mid, at(0))).state

describe('first sight', () => {
  it('takes Slack’s pointer from a page or an event', () => {
    expect(settled).toMatchObject({ lastReadTs: pointer.mid, slackReadTs: pointer.mid, observedAt: at(0) })
    expect(observeServerRead(emptyReadState, event(pointer.mid, at(5))).state).toMatchObject({ lastReadTs: pointer.mid, lastServerEventTs: at(5) })
  })
})

describe('events from other clients', () => {
  it('apply in Slack’s order and drop older ones', () => {
    const first = observeServerRead(settled, event(pointer.latest, at(10)))
    expect(first).toMatchObject({ outcome: 'applied', state: { lastReadTs: pointer.latest, lastServerEventTs: at(10) } })
    expect(observeServerRead(first.state, event(pointer.old, at(9))).outcome).toBe('ignored')
  })

  it('a changed pointer clears Mark as unread; a repeated one keeps it', () => {
    const unread: ReadState = { ...settled, markedUnread: true }
    expect(observeServerRead(unread, event(pointer.latest, at(10))).state.markedUnread).toBe(false)
    expect(observeServerRead(unread, event(pointer.mid, at(10))).state.markedUnread).toBe(true)
  })

  it('are noted, not applied, while a mark is pending, unless they repeat the mark', () => {
    const pending = markUnreadLocally(settled, pointer.old, at(1), true)!
    expect(observeServerRead(pending, event(pointer.latest, at(10)))).toEqual({ state: pending, outcome: 'noted' })
    expect(observeServerRead(pending, event(pointer.old, at(10))).outcome).toBe('ignored')
  })

  it('after Juno has marked, one that contradicts the pointer asks Slack instead of applying', () => {
    const marked = acknowledgeLocalWrite(markUnreadLocally(settled, pointer.old, at(1), true)!, pointer.old, at(2), true)
    expect(observeServerRead(marked, event(pointer.latest, at(10))).outcome).toBe('lookup')
    // Its own echo repeats the pointer, keeps the flag and moves the watermarks.
    const echo = observeServerRead(marked, event(pointer.old, at(11), at(3)))
    expect(echo).toMatchObject({ outcome: 'applied', state: { lastReadTs: pointer.old, markedUnread: true, lastServerEventTs: at(11), observedAt: at(3) } })
  })
})

describe('pages', () => {
  it('apply only when requested after the last observation', () => {
    expect(observeServerRead(settled, page(pointer.latest, at(1))).state.lastReadTs).toBe(pointer.latest)
    const marked = markReadLocally(settled, pointer.latest, at(5), false)!
    // Requested before the mark and disagreeing: too old to apply, so Slack is asked.
    expect(observeServerRead(marked, page(pointer.old, at(4))).outcome).toBe('lookup')
    expect(observeServerRead(marked, page(pointer.latest, at(4))).outcome).toBe('ignored')
  })

  it('leave a local mark alone while Slack’s pointer has not changed', () => {
    const local = markReadLocally(settled, pointer.latest, at(1), false)!
    expect(observeServerRead(local, page(pointer.mid, at(2))).outcome).toBe('ignored')
    expect(observeServerRead(local, page(pointer.old, at(2))).state).toMatchObject({ lastReadTs: pointer.old, slackReadTs: pointer.old })
  })

  it('are noted while a mark is pending', () => {
    const pending = markReadLocally(settled, pointer.latest, at(1), true)!
    expect(observeServerRead(pending, page(pointer.old, at(2))).outcome).toBe('noted')
    expect(observeServerRead(pending, page(pointer.latest, at(2))).outcome).toBe('ignored')
  })
})

describe('local marks', () => {
  it('mark read never moves the pointer back and does nothing when already read', () => {
    expect(markReadLocally(settled, pointer.old, at(1), true)).toBeUndefined()
    expect(markReadLocally({ ...settled, markedUnread: true }, pointer.old, at(1), true)).toMatchObject({ lastReadTs: pointer.mid, markedUnread: false })
  })

  it('a mirrored mark is pending with its intent and makes the topic commanded; a local one is neither', () => {
    expect(markReadLocally(settled, pointer.latest, at(1), true)).toMatchObject({
      pendingLocalWrite: true,
      commanded: true,
      intent: { lastReadTs: pointer.latest, unread: false },
      observedAt: at(1),
    })
    expect(markReadLocally(settled, pointer.latest, at(1), false)).toMatchObject({ pendingLocalWrite: false, commanded: false })
  })

  it('mark unread sets the flag and does nothing when already marked unread there', () => {
    const unread = markUnreadLocally(settled, pointer.old, at(1), false)!
    expect(unread).toMatchObject({ lastReadTs: pointer.old, markedUnread: true })
    expect(markUnreadLocally(unread, pointer.old, at(2), false)).toBeUndefined()
  })

  it('the acknowledgement records Slack’s pointer and stamps the clock; a coalesced mark stays pending', () => {
    const pending = markUnreadLocally(settled, pointer.old, at(1), true)!
    const replaced = markReadLocally(pending, pointer.latest, at(2), true)!
    const partial = acknowledgeLocalWrite(replaced, pointer.old, at(3), false)
    expect(partial).toMatchObject({ pendingLocalWrite: true, slackReadTs: pointer.old, observedAt: at(3), lastReadTs: pointer.latest })
    const done = acknowledgeLocalWrite(partial, pointer.latest, at(4), true)
    expect(done).toMatchObject({ pendingLocalWrite: false, slackReadTs: pointer.latest, localWriteAckTs: at(4) })
    // A page requested while the mark was pending cannot apply after it.
    expect(observeServerRead(done, page(pointer.mid, at(3))).outcome).toBe('lookup')
  })

  it('a refused mark forgets Slack’s pointer, so Slack’s answer applies', () => {
    const refused = rejectLocalWrite(markReadLocally(settled, pointer.latest, at(1), true)!, at(2))
    expect(refused).toMatchObject({ pendingLocalWrite: false, lastReadTs: pointer.latest })
    expect(observeServerRead(refused, page(pointer.mid, at(3))).state.lastReadTs).toBe(pointer.mid)
  })
})

describe('tsBefore', () => {
  it('is one microsecond earlier, across a second boundary', () => {
    expect(tsBefore('1700000000.000100' as Ts)).toBe('1700000000.000099')
    expect(tsBefore('1700000001.000000' as Ts)).toBe('1700000000.999999')
  })
})

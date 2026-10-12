import { describe, expect, it } from 'vitest'
import { acknowledgeLocalWrite, applyServerRead, markReadLocally, markUnreadLocally, type ReadState } from '../src/index'
import { HOUR, NOW, ts } from './fixtures'

const t = (ago: number) => ts(NOW - ago)

describe('read-state conflict rule', () => {
  const settled: ReadState = { lastReadTs: t(3 * HOUR), markedUnread: false, pendingLocalWrite: false }

  it('applies a server mark when nothing is pending', () => {
    const next = applyServerRead(settled, { lastReadTs: t(HOUR), eventTs: t(HOUR) })
    expect(next).toEqual({ lastReadTs: t(HOUR), markedUnread: false, pendingLocalWrite: false, lastServerEventTs: t(HOUR) })
  })

  it('a pending local write wins over server events', () => {
    const pending = markReadLocally(settled, t(0))
    expect(pending).toMatchObject({ lastReadTs: t(0), pendingLocalWrite: true })
    expect(applyServerRead(pending, { lastReadTs: t(HOUR), eventTs: t(0) })).toBe(pending)
  })

  it('after the acknowledgement, events older than it are ignored and newer ones apply', () => {
    const acked = acknowledgeLocalWrite(markReadLocally(settled, t(HOUR)), t(HOUR / 2))
    expect(acked.pendingLocalWrite).toBe(false)
    const stale = applyServerRead(acked, { lastReadTs: t(2 * HOUR), eventTs: t(HOUR) })
    expect(stale).toBe(acked)
    const fresh = applyServerRead(acked, { lastReadTs: t(2 * HOUR), eventTs: t(0) })
    expect(fresh.lastReadTs).toBe(t(2 * HOUR))
  })

  it('applies server events in event order and drops out-of-order ones', () => {
    const first = applyServerRead(settled, { lastReadTs: t(HOUR), eventTs: t(HOUR) })
    const older = applyServerRead(first, { lastReadTs: t(2 * HOUR), eventTs: t(2 * HOUR) })
    expect(older).toBe(first)
  })

  it('mark unread keeps at least one unread until a server mark clears it', () => {
    const unread = markUnreadLocally(settled, t(2 * HOUR))
    expect(unread).toMatchObject({ lastReadTs: t(2 * HOUR), markedUnread: true, pendingLocalWrite: true })
    const acked = acknowledgeLocalWrite(unread, t(HOUR))
    expect(applyServerRead(acked, { lastReadTs: t(0), eventTs: t(0) }).markedUnread).toBe(false)
  })

  it('never moves the local pointer backwards on mark read', () => {
    expect(markReadLocally(settled, t(5 * HOUR)).lastReadTs).toBe(t(3 * HOUR))
  })
})

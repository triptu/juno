// The renderer's delta cache: unchanged rows and an unchanged order keep
// their identity, so per-row atoms and React.memo do not re-render.
import { describe, expect, it } from 'vitest'
import { applyListDelta, emptyWindow } from '../src/index'

const meta = { seq: 1, queryMs: 0, encodeMs: 0, at: 0 }

describe('applyListDelta', () => {
  it('keeps row identity when rev is unchanged and order identity when equal', () => {
    const a = { id: 'a', rev: 1, title: 'A' }
    const b = { id: 'b', rev: 1, title: 'B' }
    const first = applyListDelta(emptyWindow<typeof a>(), { reset: true, order: ['a', 'b'], upsert: [a, b], remove: [], meta })
    expect(first.rows.get('a')).toBe(a)

    const b2 = { id: 'b', rev: 2, title: 'B2' }
    const second = applyListDelta(first, { reset: false, order: ['a', 'b'], upsert: [b2], remove: [], meta: { ...meta, seq: 2 } })
    expect(second.order).toBe(first.order)
    expect(second.rows.get('a')).toBe(a)
    expect(second.rows.get('b')).toBe(b2)

    const third = applyListDelta(second, { reset: false, order: ['b'], upsert: [], remove: ['a'], meta: { ...meta, seq: 3 } })
    expect(third.order).toEqual(['b'])
    expect(third.rows.has('a')).toBe(false)
    expect(third.rows.get('b')).toBe(b2)
  })

  it('keeps the objects of rows a reset repeats with the same rev, so a reconnect re-renders only what changed', () => {
    const a = { id: 'a', rev: 1, title: 'A' }
    const b = { id: 'b', rev: 1, title: 'B' }
    const first = applyListDelta(emptyWindow<typeof a>(), { reset: true, order: ['a', 'b'], upsert: [a, b], remove: [], meta })
    const again = applyListDelta(first, {
      reset: true,
      order: ['a', 'b'],
      upsert: [{ ...a }, { id: 'b', rev: 2, title: 'B2' }],
      remove: [],
      meta: { ...meta, seq: 1 },
    })
    expect(again.rows.get('a')).toBe(a)
    expect(again.rows.get('b')).toEqual({ id: 'b', rev: 2, title: 'B2' })
    expect(again.order).toBe(first.order)
  })

  it('drops everything on reset', () => {
    const a = { id: 'a', rev: 1 }
    const first = applyListDelta(emptyWindow<typeof a>(), { reset: true, order: ['a'], upsert: [a], remove: [], meta })
    const reset = applyListDelta(first, { reset: true, order: [], upsert: [], remove: [], meta })
    expect(reset.rows.size).toBe(0)
  })
})

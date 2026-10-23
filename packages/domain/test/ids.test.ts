import { Schema } from 'effect'
import { describe, expect, it } from 'bun:test'
import { ChannelId, TopicId, Ts, compareTs, mainTopicId, maxTs, parseTopicId, threadTopicId, millisToTs, tsBefore, tsToMillis } from '../src/index'

const C = ChannelId.make('C0ENG')

describe('topic ids', () => {
  it('parse back what they were built from', () => {
    expect(parseTopicId(threadTopicId(C, Ts.make('1728000000.123456')))).toEqual<unknown>({ kind: 'thread', channel: 'C0ENG', threadTs: '1728000000.123456' })
    expect(parseTopicId(mainTopicId(C))).toEqual<unknown>({ kind: 'main', channel: 'C0ENG' })
  })

  it.each(['', 'x:C0ENG', 'm:', 'm:C0ENG:extra', 't:C0ENG', 't:C0ENG:notats', 'g:C0ENG:g1', 'C0ENG'])('rejects %j', (bad) => {
    expect(parseTopicId(bad)).toBeUndefined()
  })

  it('rejects malformed timestamps and topic ids at the schema', () => {
    const decode = Schema.decodeUnknownSync(Ts)
    expect(() => decode('1728000000')).toThrow()
    expect(() => decode('abc')).toThrow()
    expect(decode('1728000000.000001')).toBe<string>('1728000000.000001')
    expect(() => Schema.decodeUnknownSync(TopicId)('x:C0ENG')).toThrow()
    expect(Schema.decodeUnknownSync(TopicId)('m:C0ENG')).toBe<string>('m:C0ENG')
  })
})

describe('timestamps', () => {
  it('compares by seconds then microseconds, not as floats', () => {
    const a = Ts.make('1728000000.000001')
    const b = Ts.make('1728000000.000002')
    const c = Ts.make('1728000001.000000')
    expect(compareTs(a, b)).toBeLessThan(0)
    expect(compareTs(b, a)).toBeGreaterThan(0)
    expect(compareTs(a, a)).toBe(0)
    expect(compareTs(c, b)).toBeGreaterThan(0)
    expect(compareTs(Ts.make('999999999.000000'), Ts.make('1000000000.000000'))).toBeLessThan(0)
    expect(maxTs(a, b)).toBe(b)
  })

  it('steps one microsecond earlier, across a second boundary', () => {
    expect(tsBefore(Ts.make('1700000000.000100'))).toBe<string>('1700000000.000099')
    expect(tsBefore(Ts.make('1700000001.000000'))).toBe<string>('1700000000.999999')
  })

  it('round-trips through milliseconds', () => {
    const millis = Date.UTC(2026, 9, 12, 9, 12, 30, 250)
    expect(tsToMillis(millisToTs(millis))).toBe(millis)
    expect(millisToTs(millis)).toBe<string>(`${Math.floor(millis / 1000)}.250000`)
  })
})

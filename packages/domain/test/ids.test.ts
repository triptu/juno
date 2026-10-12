import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { ChannelId, TopicId, Ts, compareTs, groupTopicId, mainTopicId, maxTs, parseTopicId, threadTopicId, topicKindOf, tsFromMillis, tsToMillis } from '../src/index'

const C = ChannelId.make('C0ENG')

describe('topic ids', () => {
  it('builds the three kinds from ADR 0004', () => {
    expect(threadTopicId(C, Ts.make('1728000000.123456'))).toBe('t:C0ENG:1728000000.123456')
    expect(mainTopicId(C)).toBe('m:C0ENG')
    expect(groupTopicId(C, 'g1')).toBe('g:C0ENG:g1')
  })

  it('parses them back', () => {
    expect(parseTopicId('t:C0ENG:1728000000.123456')).toEqual({ kind: 'thread', channel: 'C0ENG', threadTs: '1728000000.123456' })
    expect(parseTopicId('m:C0ENG')).toEqual({ kind: 'main', channel: 'C0ENG' })
    expect(parseTopicId('g:C0ENG:g1')).toEqual({ kind: 'group', channel: 'C0ENG', groupId: 'g1' })
  })

  it.each(['', 'x:C0ENG', 'm:', 'm:C0ENG:extra', 't:C0ENG', 't:C0ENG:notats', 'g::g1', 'C0ENG'])('rejects %j', (bad) => {
    expect(parseTopicId(bad)).toBeUndefined()
  })

  it('knows the kind without parsing', () => {
    expect(topicKindOf(mainTopicId(C))).toBe('main')
    expect(topicKindOf(threadTopicId(C, Ts.make('1.000000')))).toBe('thread')
    expect(topicKindOf(groupTopicId(C, 'g'))).toBe('group')
  })

  it('rejects malformed timestamps and topic ids at the schema', () => {
    const decode = Schema.decodeUnknownSync(Ts)
    expect(() => decode('1728000000')).toThrow()
    expect(() => decode('abc')).toThrow()
    expect(decode('1728000000.000001')).toBe('1728000000.000001')
    expect(() => Schema.decodeUnknownSync(TopicId)('x:C0ENG')).toThrow()
    expect(Schema.decodeUnknownSync(TopicId)('m:C0ENG')).toBe('m:C0ENG')
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

  it('round-trips through milliseconds', () => {
    const millis = Date.UTC(2026, 9, 12, 9, 12, 30, 250)
    expect(tsToMillis(tsFromMillis(millis))).toBe(millis)
    expect(tsFromMillis(millis)).toBe(`${Math.floor(millis / 1000)}.250000`)
  })
})

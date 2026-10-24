import { Schema } from 'effect'
import { describe, expect, it } from 'bun:test'
import { ChannelId, TopicId, Ts, mainTopicId, parseTopicId, threadTopicId, tsBefore } from '../src/index'

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
  it('steps one microsecond earlier, across a second boundary', () => {
    expect(tsBefore(Ts.make('1700000000.000100'))).toBe<string>('1700000000.000099')
    expect(tsBefore(Ts.make('1700000001.000000'))).toBe<string>('1700000000.999999')
  })


})

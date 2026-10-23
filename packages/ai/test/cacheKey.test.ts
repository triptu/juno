import { describe, expect, it } from 'vitest'
import { cacheKeyOf, canonicalJson, defineStructuredTask, tasks } from '../src/index'
import { NOW, msg, stagingBill } from './fixtures'

describe('cache keys', () => {
  const input = { topicId: stagingBill.id, title: stagingBill.title, channel: '#eng', now: NOW, messages: stagingBill.recent }

  it('names the task and the entity, and hashes the input the same in any key order', () => {
    const a = cacheKeyOf(tasks.settledScore, input)
    const reordered = { messages: input.messages, now: input.now, channel: input.channel, title: input.title, topicId: input.topicId }
    const b = cacheKeyOf(tasks.settledScore, reordered)
    expect(a).toEqual({ task: 'settledScore', key: stagingBill.id, inputHash: expect.stringMatching(/^[0-9a-f]{16}$/) })
    expect(b).toEqual(a)
  })

  it('changes when the input changes, and when the task version changes', () => {
    const a = cacheKeyOf(tasks.settledScore, input)
    const later = cacheKeyOf(tasks.settledScore, { ...input, messages: [...input.messages, msg('Leo Park', 'thanks', 1)] })
    expect(later.inputHash).not.toBe(a.inputHash)
    expect(later.key).toBe(a.key)
    const bumped = defineStructuredTask({ ...tasks.settledScore, version: tasks.settledScore.version + 1 })
    expect(cacheKeyOf(bumped, input).inputHash).not.toBe(a.inputHash)
  })

  it('is stable across runs: a fixed input gives a fixed hash', () => {
    expect(cacheKeyOf(tasks.instructionRule, { text: 'Always notify me about Maya', people: [{ id: 'U1', name: 'Maya' }], channels: [] })).toEqual({
      task: 'instructionRule',
      key: '',
      inputHash: '4442eae0867b8aee',
    })
  })

  it('canonical JSON sorts keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [{ d: undefined, c: 2 }] })).toBe('{"a":[{"c":2}],"b":1}')
  })
})

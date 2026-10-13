import { describe, expect, it } from 'vitest'
import { startsGroup, threadLinkLabel, type GroupMessage } from '../src/messages'

const message: GroupMessage = { senderId: 'U0LEO', body: { blocks: [] }, isThreadRoot: false }

describe('message headers', () => {
  it.each([
    ['first message', undefined, message, true],
    ['same sender', message, message, false],
    ['new sender', message, { ...message, senderId: 'U0MAYA' }, true],
    ['quote', message, { ...message, body: { blocks: [{ kind: 'quote', children: [{ kind: 'text', text: 'Can we ship?' }] }] } }, true],
    ['thread root', message, { ...message, isThreadRoot: true }, true],
    ['new divider', message, { ...message, startsAfterDivider: true }, true],
  ] satisfies ReadonlyArray<readonly [string, GroupMessage | undefined, GroupMessage, boolean]>)('%s', (_, prev, next, expected) => {
    expect(startsGroup(prev, next)).toBe(expected)
  })
})

it.each([[0, 'Thread'], [1, '1 reply'], [2, '2 replies']] satisfies ReadonlyArray<readonly [number, string]>)('labels %i replies', (count, label) => {
  expect(threadLinkLabel(count)).toBe(label)
})


import { describe, expect, it } from 'vitest'
import { bodyFromMrkdwn } from '@juno/richtext'
import { UsergroupId, indexTopic, messageMentionsMe, messageMentionsMeDirectly, type IndexInput, type IndexMessage } from '../src/index'
import { HOUR, NOW, leoId, mayaId, me, ts } from './fixtures'

const lookups = { me, user: (id: string) => ({ U0ME: 'Alex Moreau', U0MAYA: 'Maya Chen', U0LEO: 'Leo Park' })[id] }
const senderName = (id: string | undefined) => (id === undefined ? 'Unknown' : (lookups.user(id) ?? id))

function input(messages: IndexMessage[], overrides: Partial<IndexInput> = {}): IndexInput {
  return { messages, reads: { markedUnread: false, pendingLocalWrite: false }, me: { userId: me }, lookups, senderName, ...overrides }
}

const root: IndexMessage = { ts: ts(NOW - 3 * HOUR), userId: leoId, text: 'Has anyone looked at the staging bill?' }
const reply1: IndexMessage = { ts: ts(NOW - 2 * HOUR), userId: mayaId, text: '&gt; staging bill\nYes, it doubled. <@U0ME> can you check?' }
const reply2: IndexMessage = { ts: ts(NOW - HOUR), userId: me, text: 'On it.' }

describe('topic index row', () => {
  it('computes activity, participants and the preview from the messages', () => {
    const row = indexTopic(input([reply2, root, reply1], { reads: { lastReadTs: reply2.ts, markedUnread: false, pendingLocalWrite: false } }))
    expect(row).toEqual({
      activity: { lastActivityTs: reply2.ts, messageCount: 3, unreadCount: 0, unreadExact: true, mentionsMe: false, participants: [me, mayaId, leoId] },
      preview: { sender: 'You', text: 'On it.' },
      rootTs: root.ts,
    })
  })

  it('counts unread messages after the read pointer, never my own', () => {
    const row = indexTopic(input([root, reply1, reply2], { reads: { lastReadTs: root.ts, markedUnread: false, pendingLocalWrite: false } }))
    expect(row?.activity.unreadCount).toBe(1)
    expect(row?.activity.mentionsMe).toBe(true)
    const nothingRead = indexTopic(input([root, reply1]))
    expect(nothingRead?.activity.unreadCount).toBe(2)
  })

  it('strips quote lines from the preview and names the sender', () => {
    const row = indexTopic(input([root, reply1]))
    expect(row?.preview).toEqual({ sender: 'Maya Chen', text: 'Yes, it doubled. @Alex Moreau can you check?' })
  })

  it('mark-as-unread keeps the count at one or more', () => {
    const row = indexTopic(input([root, reply2], { reads: { lastReadTs: reply2.ts, markedUnread: true, pendingLocalWrite: false } }))
    expect(row?.activity.unreadCount).toBe(1)
  })

  it('only counts a mention while it is unread', () => {
    const read = indexTopic(input([root, reply1], { reads: { lastReadTs: reply1.ts, markedUnread: false, pendingLocalWrite: false } }))
    expect(read?.activity.mentionsMe).toBe(false)
  })

  it('skips tombstones and gives nothing for an empty topic', () => {
    expect(indexTopic(input([{ ...reply1, deleted: true }, root]))?.activity.messageCount).toBe(1)
    expect(indexTopic(input([]))).toBeUndefined()
  })

  it('reports inexact counts when history is incomplete', () => {
    expect(indexTopic(input([root], { historyComplete: false }))?.activity.unreadExact).toBe(false)
  })
})

describe('mention detection', () => {
  const my = { userId: me, usergroupIds: [UsergroupId.make('S0ONCALL')] }
  it('sees a direct mention, a usergroup I belong to, and broadcasts', () => {
    expect(messageMentionsMe(bodyFromMrkdwn('hey <@U0ME>'), my)).toBe(true)
    expect(messageMentionsMe(bodyFromMrkdwn('<!subteam^S0ONCALL|@oncall> wake up'), my)).toBe(true)
    expect(messageMentionsMe(bodyFromMrkdwn('<!here> standup'), my)).toBe(true)
    expect(messageMentionsMe(bodyFromMrkdwn('hey <@U0MAYA>'), my)).toBe(false)
  })

  it('does not count @here as a direct mention', () => {
    expect(messageMentionsMeDirectly(bodyFromMrkdwn('<!channel> hi'), my)).toBe(false)
    expect(messageMentionsMeDirectly(bodyFromMrkdwn('<@U0ME> hi'), my)).toBe(true)
  })
})

import { describe, expect, it } from 'bun:test'
import { ignoreEvidence, textMentionsMeDirectly, unfollowEvidence, UserId, UsergroupId, type UnreadStretch } from '../src/index'
import { DAY, NOW } from './fixtures'

const thread = (overrides: Partial<UnreadStretch> = {}): UnreadStretch => ({
  now: NOW,
  start: NOW - 20 * DAY,
  lastRead: NOW - 20 * DAY,
  firstUnread: NOW - 18 * DAY,
  lastActivity: NOW - DAY,
  unread: 14,
  exact: true,
  mentionsMe: false,
  markedUnread: false,
  pinned: false,
  ...overrides,
})

const channel = (overrides: Partial<UnreadStretch> = {}): UnreadStretch => ({
  now: NOW,
  lastRead: NOW - 35 * DAY,
  firstUnread: NOW - 6 * DAY,
  lastActivity: NOW - DAY,
  unread: 312,
  exact: false,
  mentionsMe: false,
  markedUnread: false,
  pinned: false,
  ...overrides,
})

describe('Unfollow threads you never open', () => {
  it('proposes a followed thread with unread replies over two weeks, and says whether any was ever read', () => {
    expect(unfollowEvidence(thread())).toEqual({ count: 14, atLeast: false })
    expect(unfollowEvidence(thread({ lastRead: NOW - 19 * DAY, exact: false }))).toEqual({ count: 14, atLeast: true, lastRead: NOW - 19 * DAY })
  })

  it('waits for two weeks of unread replies, five of them, and a reply in the last week', () => {
    expect(unfollowEvidence(thread({ firstUnread: NOW - 13 * DAY }))).toBeUndefined()
    expect(unfollowEvidence(thread({ unread: 4 }))).toBeUndefined()
    expect(unfollowEvidence(thread({ lastActivity: NOW - 8 * DAY }))).toBeUndefined()
    expect(unfollowEvidence(thread({ firstUnread: undefined }))).toBeUndefined()
  })

  it('never proposes a thread that mentions you, that you marked unread or pinned', () => {
    expect(unfollowEvidence(thread({ mentionsMe: true }))).toBeUndefined()
    expect(unfollowEvidence(thread({ markedUnread: true }))).toBeUndefined()
    expect(unfollowEvidence(thread({ pinned: true }))).toBeUndefined()
  })

  it('counts two weeks again from Keep following, or from a visit', () => {
    expect(unfollowEvidence(thread({ keptAt: NOW - 3 * DAY }))).toBeUndefined()
    expect(unfollowEvidence(thread({ visitedAt: NOW - 3 * DAY }))).toBeUndefined()
    expect(unfollowEvidence(thread({ keptAt: NOW - 15 * DAY }))).toEqual({ count: 14, atLeast: false })
  })
})

describe('Ignore channels you never read', () => {
  it('proposes a channel with nothing read for 30 days and more than 50 messages since', () => {
    expect(ignoreEvidence(channel())).toEqual({ count: 312, atLeast: true, lastRead: NOW - 35 * DAY })
    expect(ignoreEvidence(channel({ unread: 50 }))).toBeUndefined()
    expect(ignoreEvidence(channel({ lastRead: NOW - 29 * DAY }))).toBeUndefined()
  })

  it('needs a read pointer to say when, and never proposes a channel that mentions you, marked unread or pinned', () => {
    expect(ignoreEvidence(channel({ lastRead: undefined }))).toBeUndefined()
    expect(ignoreEvidence(channel({ mentionsMe: true }))).toBeUndefined()
    expect(ignoreEvidence(channel({ markedUnread: true }))).toBeUndefined()
    expect(ignoreEvidence(channel({ pinned: true }))).toBeUndefined()
  })

  it('counts 30 days again from Keep showing', () => {
    expect(ignoreEvidence(channel({ keptAt: NOW - 10 * DAY }))).toBeUndefined()
    expect(ignoreEvidence(channel({ keptAt: NOW - 31 * DAY }))).toBeDefined()
  })
})

describe('direct mentions in raw text', () => {
  const me = { userId: UserId.make('U0ME'), usergroupIds: [UsergroupId.make('S0PLATFORM')] }
  it('counts the user by name and a group they are in, never @here or @channel', () => {
    expect(textMentionsMeDirectly('<@U0ME> can you look?', me)).toBe(true)
    expect(textMentionsMeDirectly('cc <@U0ME|me>', me)).toBe(true)
    expect(textMentionsMeDirectly('<!subteam^S0PLATFORM> deploy at 3', me)).toBe(true)
    expect(textMentionsMeDirectly('<!subteam^S0DESIGN> review', me)).toBe(false)
    expect(textMentionsMeDirectly('<!here> deploy at 3', me)).toBe(false)
    expect(textMentionsMeDirectly('<!channel> deploy at 3', me)).toBe(false)
    expect(textMentionsMeDirectly('<@U0MEX> hi', me)).toBe(false)
  })
})

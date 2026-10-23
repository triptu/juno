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
    // Two weeks again from Keep following.
    expect(unfollowEvidence(thread({ keptAt: NOW - 15 * DAY }))).toEqual({ count: 14, atLeast: false })
  })

  it.each<[string, Partial<UnreadStretch>]>([
    ['less than two weeks unread', { firstUnread: NOW - 13 * DAY }],
    ['fewer than five unread', { unread: 4 }],
    ['no reply in the last week', { lastActivity: NOW - 8 * DAY }],
    ['nothing unread', { firstUnread: undefined }],
    ['a mention of you', { mentionsMe: true }],
    ['marked unread', { markedUnread: true }],
    ['pinned', { pinned: true }],
    ['kept following 3 days ago', { keptAt: NOW - 3 * DAY }],
    ['a visit 3 days ago', { visitedAt: NOW - 3 * DAY }],
  ])('not with %s', (_, overrides) => {
    expect(unfollowEvidence(thread(overrides))).toBeUndefined()
  })
})

describe('Ignore channels you never read', () => {
  it('proposes a channel with nothing read for 30 days and more than 50 messages since', () => {
    expect(ignoreEvidence(channel())).toEqual({ count: 312, atLeast: true, lastRead: NOW - 35 * DAY })
    // 30 days again from Keep showing.
    expect(ignoreEvidence(channel({ keptAt: NOW - 31 * DAY }))).toBeDefined()
  })

  it.each<[string, Partial<UnreadStretch>]>([
    ['50 messages', { unread: 50 }],
    ['a read 29 days ago', { lastRead: NOW - 29 * DAY }],
    ['no read pointer', { lastRead: undefined }],
    ['a mention of you', { mentionsMe: true }],
    ['marked unread', { markedUnread: true }],
    ['pinned', { pinned: true }],
    ['kept showing 10 days ago', { keptAt: NOW - 10 * DAY }],
  ])('not with %s', (_, overrides) => {
    expect(ignoreEvidence(channel(overrides))).toBeUndefined()
  })
})

describe('direct mentions in raw text', () => {
  const me = { userId: UserId.make('U0ME'), usergroupIds: [UsergroupId.make('S0PLATFORM')] }
  // The user by name and a group they are in, never @here or @channel.
  it.each([
    ['<@U0ME> can you look?', true],
    ['cc <@U0ME|me>', true],
    ['<!subteam^S0PLATFORM> deploy at 3', true],
    ['<!subteam^S0DESIGN> review', false],
    ['<!here> deploy at 3', false],
    ['<!channel> deploy at 3', false],
    ['<@U0MEX> hi', false],
  ])('%j is %p', (text, expected) => {
    expect(textMentionsMeDirectly(text, me)).toBe(expected)
  })
})

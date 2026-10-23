import { describe, expect, it } from 'vitest'
import {
  decideHuddleAlert,
  decideNotification,
  defaultNotificationSettings,
  inHours,
  notificationIsMuted,
  nextSwitch,
  nextHoursStart,
  localTime,
  scheduledPresence,
  untilLabel,
  readLevel,
  pausedLabel,
  presenceLabel,
  seenNote,
  type DecisionContext,
  type Hours,
  type LocalTime,
  type NotificationCandidate,
  type NotificationSettings,
  type Reading,
} from '../src/index'
import { alerts, eng, group, hiring, leoId, maya, mayaId } from './fixtures'

const at = (weekday: LocalTime['weekday'], hour: number, minute = 0): LocalTime => ({ weekday, minutes: hour * 60 + minute })
const MON = 1
const SAT = 6

// Notifications stop at 6pm; Slack shows the owner active until 8pm (the owner's example).
const settings: NotificationSettings = {
  ...defaultNotificationSettings,
  notificationHours: { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 18 * 60 },
  presenceHours: { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 20 * 60 },
  channels: { C0INCIDENTS: 'always', [eng.id]: 'never' },
  people: { [mayaId]: 'always', U0SAM: 'never' },
  instructions: [
    { id: 'greet', direction: 'stay', text: 'greetings' },
    { id: 'contracts', direction: 'notify', text: 'contracts' },
  ],
}
const incidents = { id: 'C0INCIDENTS', kind: 'public', name: 'incidents' } as const
const sam = 'U0SAM' as never
const ai: DecisionContext = { aiAssist: true, userName: (id) => ({ U0MAYA: 'Maya Chen', U0SAM: 'Sam Okafor', U0LEO: 'Leo Park' })[id] }
const aiOff: DecisionContext = { ...ai, aiAssist: false }

describe('effective notification level for Home', () => {
  it('mutes on Never unless an applicable Always level overrides it', () => {
    expect(notificationIsMuted('never')).toBe(true)
    expect(notificationIsMuted(undefined, 'never', undefined)).toBe(true)
    expect(notificationIsMuted('always', 'never')).toBe(false)
    expect(notificationIsMuted(undefined, undefined, undefined)).toBe(false)
  })

  it('reads levels stored before Always and Auto', () => {
    expect([readLevel('always'), readLevel('always'), readLevel('never'), readLevel('matters'), readLevel(undefined)]).toEqual(['always', 'always', 'never', undefined, undefined])
  })
})

function candidate(overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
  return { channel: hiring, senderId: leoId, mentionsMe: false, text: 'the build is green', at: at(MON, 12), ...overrides }
}

const read = (needsYou: Reading['needsYou'], probabilities: Reading['probabilities'], instruction?: Reading['instruction']): Reading =>
  ({ needsYou, probabilities, ...(instruction === undefined ? {} : { instruction }) })
const asks = read('ask', { ask: 0.8, fyi: 0.2 })
const fyi = read('fyi', { ask: 0.2, fyi: 0.8 })
const thread = 't:C0HIRING:1.000001'
const started = { ...settings, alwaysNotify: { startedThreads: true } }
const followed = { ...settings, alwaysNotify: { followedThreads: true } }
const live = { ownerWroteMinutesAgo: 2, ownerWroteLast: true }

describe('the decision order', () => {
  it.each([
    // 1. Hours: nothing gets through, not even Always.
    ['outside hours, Always stays', candidate({ senderId: mayaId, at: at(MON, 22) }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'hours', reason: 'Outside your notification hours.' }],
    ['outside hours, a direct mention stays', candidate({ mentionsMe: true, mentionsMeDirectly: true, at: at(SAT, 12) }), settings, ai, asks, { outcome: 'stay', decidedBy: 'hours' }],
    // 2. Always, which beats Never.
    ['a channel on Always notifies', candidate({ channel: incidents as never }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'always', reason: '#incidents is set to Always.', target: { kind: 'channel', id: 'C0INCIDENTS' } }],
    ['Always on the person beats Never on the channel', candidate({ channel: eng, senderId: mayaId }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'always', reason: 'Maya Chen is set to Always.' }],
    ['Always on the thread beats Never on the channel', candidate({ topicId: thread }), { ...settings, threads: { [thread]: 'always' }, channels: { C0HIRING: 'never' } }, ai, undefined, { outcome: 'notify', decidedBy: 'always', reason: 'This thread is set to Always.' }],
    ['Always beats an ignored channel', candidate({ channel: alerts, senderId: mayaId }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'always' }],
    // 3. Never and ignored, with the direct-mention exception.
    ['a channel on Never stays', candidate({ channel: eng }), settings, ai, asks, { outcome: 'stay', decidedBy: 'never', reason: '#eng is set to Never.', target: { kind: 'channel', id: 'C0ENG' } }],
    ['a person on Never stays', candidate({ senderId: sam }), settings, ai, asks, { outcome: 'stay', decidedBy: 'never', reason: 'Sam Okafor is set to Never.' }],
    ['a thread on Never stays', candidate({ topicId: thread }), { ...settings, threads: { [thread]: 'never' } }, ai, asks, { outcome: 'stay', decidedBy: 'never', reason: 'This thread is set to Never.' }],
    ['@here in a thread on Never stays, though Mentions is on', candidate({ topicId: thread, mentionsMe: true, mentionsMeDirectly: false }), { ...settings, threads: { [thread]: 'never' } }, ai, undefined, { outcome: 'stay', decidedBy: 'never' }],
    ['an ignored channel stays', candidate({ channel: alerts }), settings, ai, asks, { outcome: 'stay', decidedBy: 'ignored', reason: '#alerts-prod is ignored.' }],
    ['a direct mention gets through Never', candidate({ channel: eng, mentionsMe: true, mentionsMeDirectly: true }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'directMention', reason: 'Mentions you by name. That gets through Never.' }],
    ['a direct mention gets through an ignored channel', candidate({ channel: alerts, mentionsMe: true, mentionsMeDirectly: true }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'directMention', reason: 'Mentions you by name. That gets through ignored channels.' }],
    ['@here does not get through Never', candidate({ channel: eng, mentionsMe: true, mentionsMeDirectly: false }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'never' }],
    // 4. The Always notify switches.
    ['mentions notify by default', candidate({ mentionsMe: true }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'alwaysNotify', reason: 'Mentions always notify.' }],
    ['DMs are read by default', candidate({ channel: maya }), settings, ai, undefined, { needsReading: true }],
    ['the DMs switch notifies', candidate({ channel: maya }), { ...settings, alwaysNotify: { dms: true } }, ai, undefined, { outcome: 'notify', decidedBy: 'alwaysNotify', reason: 'Direct messages always notify.' }],
    ['the group DMs switch notifies', candidate({ channel: group }), { ...settings, alwaysNotify: { groupDms: true } }, ai, undefined, { outcome: 'notify', decidedBy: 'alwaysNotify', reason: 'Group DMs always notify.' }],
    ['threads you started', candidate({ topicId: thread, facts: { ownerStartedThread: true } }), started, ai, undefined, { outcome: 'notify', decidedBy: 'alwaysNotify', reason: 'A reply in a thread you started.' }],
    ['threads you follow', candidate({ topicId: thread, facts: { followed: true } }), followed, ai, undefined, { outcome: 'notify', decidedBy: 'alwaysNotify', reason: 'A reply in a thread you follow.' }],
    ['threads you follow include threads you started', candidate({ topicId: thread, facts: { ownerStartedThread: true } }), followed, ai, undefined, { outcome: 'notify', decidedBy: 'alwaysNotify', reason: 'A reply in a thread you started.' }],
    ['threads you started do not include threads you follow', candidate({ topicId: thread, facts: { followed: true } }), started, ai, fyi, { outcome: 'stay', decidedBy: 'reading' }],
    // 5. AI assist off.
    ['AI assist off: a DM notifies', candidate({ channel: maya }), settings, aiOff, undefined, { outcome: 'notify', decidedBy: 'aiOff' }],
    ['AI assist off: the rest stays', candidate(), settings, aiOff, undefined, { outcome: 'stay', decidedBy: 'aiOff' }],
    // 6.1 Closers, only after the owner wrote last.
    ['a thanks after the owner wrote stays', candidate({ channel: maya, senderId: mayaId, text: 'Thanks!', facts: live }), { ...settings, people: {} }, ai, undefined, { outcome: 'stay', decidedBy: 'closer', reason: 'Maya thanked you. Nothing to do.' }],
    ['an emoji closer stays', candidate({ channel: maya, text: '👍', facts: live }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'closer' }],
    ['"sounds good." is a closer', candidate({ channel: maya, text: 'Sounds good.', facts: live }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'closer' }],
    ['a closer with a question is not one', candidate({ channel: maya, text: 'thanks, can you approve?', facts: live }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'live' }],
    ['a closer when the owner did not write last is read', candidate({ channel: maya, text: 'thanks', facts: { ownerWroteLast: false } }), settings, ai, undefined, { needsReading: true }],
    // 6.2 A live conversation.
    ['the owner wrote 2 minutes ago', candidate({ channel: maya, text: 'yes, Thursday', facts: { ownerWroteMinutesAgo: 2 } }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'live', reason: 'You were talking with Leo 2 minutes ago.' }],
    ['the owner wrote 30 minutes ago', candidate({ channel: maya, text: 'yes, Thursday', facts: { ownerWroteMinutesAgo: 30 } }), settings, ai, undefined, { needsReading: true }],
    // 6.3 The reading: instructions, then the needs-you sum.
    ['the reading says it asks', candidate({ senderId: sam, channel: hiring }), { ...settings, people: {} }, ai, asks, { outcome: 'notify', decidedBy: 'reading', reason: 'Sam asks you something.' }],
    ['the reading says it is an update', candidate(), settings, ai, fyi, { outcome: 'stay', decidedBy: 'reading', reason: 'An update with nothing asked of you.' }],
    ['the needs-you options add up', candidate(), settings, ai, read('fyi', { ask: 0.2, decision: 0.2, serious: 0.1, fyi: 0.5 }), { outcome: 'notify', decidedBy: 'reading', reason: 'Leo asks you something.' }],
    ['a decision names the channel', candidate(), settings, ai, read('decision', { decision: 0.9 }), { outcome: 'notify', reason: 'A decision is being made in #hiring.' }],
    ['a Notify me instruction at 0.7', candidate(), settings, ai, read('fyi', { fyi: 1 }, { id: 'contracts', confidence: 0.7 }), { outcome: 'notify', decidedBy: 'instruction', reason: 'Your instructions: Notify me: contracts', instructionId: 'contracts' }],
    ['a Notify me instruction below 0.7 falls to the sum', candidate(), settings, ai, read('fyi', { fyi: 1 }, { id: 'contracts', confidence: 0.69 }), { outcome: 'stay', decidedBy: 'reading' }],
    ["a Don't notify instruction at 0.85", candidate(), settings, ai, read('greeting', { ask: 0.6, greeting: 0.4 }, { id: 'greet', confidence: 0.85 }), { outcome: 'stay', decidedBy: 'instruction', reason: "Your instructions: Don't notify: greetings" }],
    ["a Don't notify instruction below 0.85 falls to the sum", candidate(), settings, ai, read('ask', { ask: 0.6, greeting: 0.4 }, { id: 'greet', confidence: 0.8 }), { outcome: 'notify', decidedBy: 'reading' }],
    ['a removed instruction is ignored', candidate(), settings, ai, read('fyi', { fyi: 1 }, { id: 'gone', confidence: 1 }), { outcome: 'stay', decidedBy: 'reading' }],
    ['no reading in time: a DM notifies', candidate({ channel: maya }), settings, ai, 'failed', { outcome: 'notify', decidedBy: 'timeout', reason: "Juno couldn't read this in time." }],
    ['no reading in time: a channel message stays', candidate(), settings, ai, 'failed', { outcome: 'stay', decidedBy: 'timeout' }],
    // 7. A banner holds the conversation for a minute.
    ['a second message within a minute of a banner stays', candidate({ channel: incidents as never, facts: { bannerSecondsAgo: 30 } }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'burst' }],
    ['a minute after a banner it notifies again', candidate({ channel: incidents as never, facts: { bannerSecondsAgo: 60 } }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'always' }],
  ] as const)('%s', (_name, message, config, context, reading, expected) => {
    expect(decideNotification(message, config, context, reading)).toMatchObject(expected)
  })
})

describe('hours', () => {
  const work: Hours = { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 19 * 60 }
  const nights: Hours = { days: [5], from: 22 * 60, to: 2 * 60 }

  it('holds on the chosen days between from and to', () => {
    expect(inHours(at(MON, 9), work)).toBe(true)
    expect(inHours(at(MON, 18, 59), work)).toBe(true)
    expect(inHours(at(MON, 19), work)).toBe(false)
    expect(inHours(at(SAT, 12), work)).toBe(false)
    expect(inHours(at(MON, 12), { ...work, to: work.from })).toBe(false)
  })

  it('a span that crosses midnight belongs to the day it starts', () => {
    expect(inHours(at(5, 23), nights)).toBe(true)
    expect(inHours(at(SAT, 1), nights)).toBe(true)
    expect(inHours(at(SAT, 23), nights)).toBe(false)
    expect(inHours(at(5, 1), nights)).toBe(false)
  })

  it('finds the next switch and says until when', () => {
    expect(nextSwitch(at(MON, 12), work)).toMatchObject({ starts: false, inMinutes: 7 * 60 })
    expect(untilLabel(at(MON, 12), work)).toBe('until 7pm')
    expect(untilLabel(at(MON, 20), work)).toBe('until tomorrow 9am')
    expect(untilLabel(at(5, 20), work)).toBe('until Mon 9am')
    expect(untilLabel(at(MON, 7, 30), work)).toBe('until 9am')
    expect(untilLabel(at(MON, 12), { days: [], from: 0, to: 60 })).toBeUndefined()
  })
})

describe('presence', () => {
  it('is active inside presence hours and away outside, apart from notification hours', () => {
    // 7pm on a Monday: notifications have stopped, Slack still shows the owner active.
    expect(inHours(at(MON, 19), settings.notificationHours)).toBe(false)
    expect(scheduledPresence(at(MON, 19), settings.presenceHours)).toBe('active')
    expect(scheduledPresence(at(MON, 20), settings.presenceHours)).toBe('away')
    expect(scheduledPresence(at(SAT, 12), settings.presenceHours)).toBe('away')
  })

  it('says until when the status changes next', () => {
    const work = settings.presenceHours
    expect(presenceLabel(at(MON, 12), 'active', work)).toBe('Active')
    expect(presenceLabel(at(MON, 21), 'away', work)).toBe('Away until tomorrow 9am')
    // Away by hand inside the hours lasts until they start again.
    expect(presenceLabel(at(MON, 12), 'away', work)).toBe('Away until tomorrow 9am')
    // Active by hand before the hours runs to their end.
    expect(presenceLabel(at(MON, 8), 'active', work)).toBe('Active until 8pm')
    expect(presenceLabel(at(MON, 12), 'away', { days: [], from: 540, to: 1140 })).toBe('Away')
    expect(pausedLabel(at(MON, 12), settings.notificationHours)).toBeUndefined()
    expect(pausedLabel(at(5, 20), settings.notificationHours)).toBe('Paused until Mon 9am')
  })

  it('says what Slack shows colleagues only when it differs from the setting', () => {
    expect(seenNote('active', 'active')).toBeUndefined()
    expect(seenNote('away', 'away')).toBeUndefined()
    expect(seenNote('active', 'away')).toBe('Slack shows you away')
    expect(seenNote('away', 'active')).toBe('Slack shows you active')
    // Until Slack answers, the dot shows away; only an active setting differs from that.
    expect(seenNote('active', undefined)).toBe('Connecting to Slack')
    expect(seenNote('away', undefined)).toBeUndefined()
  })

  it('uses the same hours for both by default', () => {
    expect(defaultNotificationSettings.presenceHours).toEqual(defaultNotificationSettings.notificationHours)
  })
})


describe('calendar notification starts', () => {
  const monday = new Date(2026, 9, 12, 8, 30)
  const hours: Hours = { days: [1], from: 540, to: 1140 }
  it('keeps local times and skips a start that has already happened', () => {
    expect(localTime(monday.getTime())).toEqual({ weekday: 1, minutes: 510 })
    expect(nextHoursStart(monday.getTime(), hours)).toBe(new Date(2026, 9, 12, 9).getTime())
    expect(nextHoursStart(new Date(2026, 9, 12, 9).getTime(), hours)).toBe(new Date(2026, 9, 19, 9).getTime())
    expect(nextHoursStart(monday.getTime(), { ...hours, days: [] })).toBeUndefined()
    expect(nextHoursStart(monday.getTime(), { ...hours, to: 540 })).toBeUndefined()
  })
  it('uses the day on which an overnight window starts', () => {
    expect(nextHoursStart(monday.getTime(), { days: [1], from: 1320, to: 120 })).toBe(new Date(2026, 9, 12, 22).getTime())
  })
})

describe('incoming huddle', () => {
  const huddle = (channelId: string, startedBy: string, when: LocalTime) => decideHuddleAlert({ channelId, startedBy, at: when }, settings)

  it('rings inside notification hours and is quiet outside them', () => {
    expect(huddle('C0PRODUCT', 'U0LEO', at(MON, 10))).toBe('ring')
    expect(huddle('C0PRODUCT', 'U0LEO', at(MON, 19))).toBe('quiet')
    expect(huddle('C0PRODUCT', 'U0LEO', at(SAT, 10))).toBe('quiet')
  })

  it('follows Always and Never on the conversation or the person who started it, Always first', () => {
    expect(huddle('C0INCIDENTS', 'U0LEO', at(MON, 10))).toBe('ring')
    expect(huddle('C0INCIDENTS', 'U0LEO', at(SAT, 23))).toBe('quiet')
    expect(huddle('C0PRODUCT', mayaId, at(MON, 10))).toBe('ring')
    expect(huddle(eng.id, 'U0LEO', at(MON, 10))).toBe('quiet')
    expect(huddle('C0PRODUCT', 'U0SAM', at(MON, 10))).toBe('quiet')
    expect(huddle(eng.id, mayaId, at(MON, 10))).toBe('ring')
  })
})

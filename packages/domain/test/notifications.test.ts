import { describe, expect, it } from 'bun:test'
import {
  decideHuddleAlert,
  decideNotification,
  defaultNotificationSettings,
  inHours,
  notificationIsMuted,
  nextSwitch,
  nextHoursStart,
  normalHours,
  groupHours,
  withGroupHours,
  localTime,
  pausedLabel,
  slackScheduleFor,
  scheduledPresence,
  untilLabel,
  presenceLabel,
  type DecisionContext,
  type Hours,
  type LocalTime,
  type NotificationCandidate,
  type NotificationSettings,
  type Reading,
} from '../src/index'
import { alerts, eng, group, hiring, leoId, maya, mayaId } from './fixtures'

const at = (weekday: LocalTime['weekday'], hour: number, minute = 0): LocalTime => ({ weekday, minutes: hour * 60 + minute })
/** The same moment as epoch milliseconds, in the week of Sunday 2026-11-01, local time. */
const dateAt = (weekday: LocalTime['weekday'], hour: number, minute = 0) => new Date(2026, 10, 1 + weekday, hour, minute).getTime()
const MON = 1
const SAT = 6

// Notifications stop at 6pm; Slack shows the owner active until 8pm (the owner's example).
const notificationHours: Hours = { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 18 * 60 }
const presenceHours: Hours = { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 20 * 60 }
const settings: NotificationSettings = {
  ...defaultNotificationSettings,
  notificationHours,
  presenceHours,
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
    ['an unfollowed thread with no level is Never', candidate({ topicId: thread, mentionsMe: true, mentionsMeDirectly: false, facts: { followed: false } }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'never' }],
    ['a direct mention gets through an unfollowed thread', candidate({ topicId: thread, mentionsMe: true, mentionsMeDirectly: true, facts: { followed: false } }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'directMention' }],
    ['a stored level wins over the follow state', candidate({ topicId: thread, facts: { followed: false } }), { ...settings, threads: { [thread]: 'always' } }, ai, undefined, { outcome: 'notify', decidedBy: 'always' }],
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
    ['"Yep!" is a closer', candidate({ channel: maya, text: 'Yep!', facts: live }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'closer' }],
    ['"nice" is a closer', candidate({ channel: group, text: 'nice', facts: live }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'closer' }],
    ['"sure?" is a closer', candidate({ channel: maya, text: 'sure?', facts: live }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'closer' }],
    ['"nice…" is a closer', candidate({ channel: maya, text: 'nice…', facts: live }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'closer' }],
    ['a question to someone else in a channel stays', candidate({ mentionsOthers: ['Dev Patel'], facts: { ownerWroteMinutesAgo: 2 } }), settings, ai, asks, { outcome: 'stay', decidedBy: 'addressedElsewhere', reason: 'Asks Dev, not you.' }],
    ['a question to someone else that also names the owner is read', candidate({ mentionsOthers: ['Dev Patel'], mentionsMe: true, mentionsMeDirectly: true }), { ...settings, alwaysNotify: { mentions: false } }, ai, undefined, { needsReading: true }],
    ['a question to someone else in a group DM stays', candidate({ channel: group, mentionsOthers: ['Maya Chen'] }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'addressedElsewhere', reason: 'Asks Maya, not you.' }],
    ['a name in a one-to-one DM is not addressed elsewhere', candidate({ channel: maya, mentionsOthers: ['Dev Patel'] }), settings, ai, undefined, { needsReading: true }],
    ['"sounds good." is a closer', candidate({ channel: maya, text: 'Sounds good.', facts: live }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'closer' }],
    ['a closer with a question is not one', candidate({ channel: maya, text: 'thanks, can you approve?', facts: live }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'live' }],
    ['a closer when the owner did not write last is read', candidate({ channel: maya, text: 'thanks', facts: { ownerWroteLast: false } }), settings, ai, undefined, { needsReading: true }],
    // 6.2 A live conversation.
    ['the owner wrote 2 minutes ago', candidate({ channel: maya, text: 'yes, Thursday', facts: { ownerWroteMinutesAgo: 2 } }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'live', reason: 'You were talking with Leo 2 minutes ago.' }],
    ['the owner wrote 30 minutes ago', candidate({ channel: maya, text: 'yes, Thursday', facts: { ownerWroteMinutesAgo: 30 } }), settings, ai, undefined, { needsReading: true }],
    // 6.3 The reading: instructions, then the needs-you sum.
    ['the reading says it asks in a DM', candidate({ senderId: sam, channel: maya }), { ...settings, people: {} }, ai, asks, { outcome: 'notify', decidedBy: 'reading', reason: 'Sam asks you something.' }],
    ['a room question in someone else\'s followed thread stays', candidate({ topicId: thread, facts: { followed: true } }), settings, ai, asks, { outcome: 'stay', decidedBy: 'reading', reason: 'Leo asks everyone, not you.' }],
    ['a room question in the owner\'s own thread notifies', candidate({ topicId: thread, facts: { followed: true, ownerStartedThread: true } }), settings, ai, asks, { outcome: 'notify', decidedBy: 'reading', reason: 'Leo asks you something.' }],
    ['an ask counts in a channel after the owner wrote last', candidate({ facts: { ownerWroteLast: true, ownerWroteMinutesAgo: 30 } }), settings, ai, asks, { outcome: 'notify', decidedBy: 'reading' }],
    ['an ask counts in a channel when the owner is named', candidate({ mentionsMe: true, mentionsMeDirectly: true }), { ...settings, alwaysNotify: { mentions: false } }, ai, asks, { outcome: 'notify', decidedBy: 'reading' }],
    ['an answer always counts', candidate(), settings, ai, read('answer', { answer: 0.6, fyi: 0.4 }), { outcome: 'notify', decidedBy: 'reading', reason: 'Leo answered your question.' }],
    ['the reading says it is an update', candidate(), settings, ai, fyi, { outcome: 'stay', decidedBy: 'reading', reason: 'An update with nothing asked of you.' }],
    ['the options that count add up', candidate({ topicId: thread, facts: { ownerStartedThread: true } }), settings, ai, read('fyi', { ask: 0.2, decision: 0.2, serious: 0.1, fyi: 0.5 }), { outcome: 'notify', decidedBy: 'reading', reason: 'Leo asks you something.' }],
    ['a decision in a thread the owner started notifies', candidate({ topicId: thread, facts: { ownerStartedThread: true } }), settings, ai, read('decision', { decision: 0.9 }), { outcome: 'notify', reason: 'A decision is being made in #hiring.' }],
    ['a decision elsewhere stays', candidate(), settings, ai, read('decision', { decision: 0.9 }), { outcome: 'stay', decidedBy: 'reading', reason: 'A discussion in #hiring, with nothing asked of you.' }],
    ['a Notify me instruction at 0.7', candidate(), settings, ai, read('fyi', { fyi: 1 }, { id: 'contracts', confidence: 0.7 }), { outcome: 'notify', decidedBy: 'instruction', reason: 'Your instructions: Notify me: contracts', instructionId: 'contracts' }],
    ['a Notify me instruction below 0.7 falls to the sum', candidate(), settings, ai, read('fyi', { fyi: 1 }, { id: 'contracts', confidence: 0.69 }), { outcome: 'stay', decidedBy: 'reading' }],
    ["a Don't notify instruction at 0.85", candidate(), settings, ai, read('greeting', { ask: 0.6, greeting: 0.4 }, { id: 'greet', confidence: 0.85 }), { outcome: 'stay', decidedBy: 'instruction', reason: "Your instructions: Don't notify: greetings" }],
    ["a Don't notify instruction below 0.85 falls to the sum", candidate({ channel: maya }), settings, ai, read('ask', { ask: 0.6, greeting: 0.4 }, { id: 'greet', confidence: 0.8 }), { outcome: 'notify', decidedBy: 'reading' }],
    ['a removed instruction is ignored', candidate(), settings, ai, read('fyi', { fyi: 1 }, { id: 'gone', confidence: 1 }), { outcome: 'stay', decidedBy: 'reading' }],
    ['no reading in time: a DM notifies', candidate({ channel: maya }), settings, ai, 'failed', { outcome: 'notify', decidedBy: 'timeout', reason: "Juno couldn't read this in time." }],
    ['no reading in time: a channel message stays', candidate(), settings, ai, 'failed', { outcome: 'stay', decidedBy: 'timeout' }],
    // 7. A banner holds the conversation for a minute.
    ['a second message within 10 seconds of a banner stays', candidate({ channel: incidents as never, facts: { bannerSecondsAgo: 9 } }), settings, ai, undefined, { outcome: 'stay', decidedBy: 'burst' }],
    ['10 seconds after a banner a message is decided on its own', candidate({ channel: incidents as never, facts: { bannerSecondsAgo: 10 } }), settings, ai, undefined, { outcome: 'notify', decidedBy: 'always' }],
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
    expect(untilLabel(at(MON, 20), work)).toBe('until Tue 9am')
    expect(untilLabel(at(5, 20), work)).toBe('until Mon 9am')
    expect(untilLabel(at(MON, 7, 30), work)).toBe('until 9am')
    expect(untilLabel(at(MON, 12), { days: [], from: 0, to: 60 })).toBeUndefined()
  })

  it('each day keeps its own hours: the check, the next start and Slack\'s schedule', () => {
    const FRI = 5
    const SUN = 0
    // Monday to Thursday 9 to 7, Friday 10pm to 2am, Saturday 11 to 2, Sunday off.
    const week: Hours = { days: [1, 2, 3, 4, 5, 6], from: 9 * 60, to: 19 * 60, dayHours: [{ day: 5, from: 22 * 60, to: 2 * 60 }, { day: 6, from: 11 * 60, to: 14 * 60 }] }
    expect(inHours(at(MON, 12), week)).toBe(true)
    expect(inHours(at(FRI, 12), week)).toBe(false)
    expect(inHours(at(FRI, 23), week)).toBe(true)
    expect(inHours(at(SAT, 1), week)).toBe(true)
    expect(inHours(at(SAT, 3), week)).toBe(false)
    expect(inHours(at(SAT, 12), week)).toBe(true)
    expect(inHours(at(SAT, 23), week)).toBe(false)
    expect(inHours(at(SUN, 1), week)).toBe(false)

    expect(pausedLabel(dateAt(FRI, 12), week)).toBe('Paused until 10pm')
    expect(pausedLabel(dateAt(SAT, 3), week)).toBe('Paused until 11am')
    expect(pausedLabel(dateAt(SAT, 15), week)).toBe('Paused until Mon 9am')
    expect(pausedLabel(dateAt(4, 20), { ...week, days: [1, 2, 3, 4, 6] })).toBe('Paused until Sat 11am')
    // A snooze inside the hours ends with the snooze; one that runs past their end lasts until they start again.
    expect(pausedLabel(dateAt(MON, 12), week, dateAt(MON, 13, 30))).toBe('Paused until 1:30pm')
    expect(pausedLabel(dateAt(MON, 18), week, dateAt(MON, 20))).toBe('Paused until Tue 9am')
    // A snooze that ends before the hours start again changes nothing about when they do.
    expect(pausedLabel(dateAt(SAT, 15), week, dateAt(SAT, 16))).toBe('Paused until Mon 9am')

    // The same hours on every day with hours are the shared hours again, and Slack's own modes.
    const sameEveryWeekday = normalHours({ days: [1, 2, 3, 4, 5], from: 8 * 60, to: 17 * 60, dayHours: [1, 2, 3, 4, 5].map((day) => ({ day: day as 1, from: 600, to: 1080 })) })
    expect(sameEveryWeekday).toEqual({ days: [1, 2, 3, 4, 5], from: 600, to: 1080 })
    expect(slackScheduleFor(sameEveryWeekday)).toEqual({ dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: '18:00', dnd_end_hour: '10:00' })
    expect(slackScheduleFor({ days: [0, 1, 2, 3, 4, 5, 6], from: 540, to: 1140, dayHours: [{ day: 6, from: 540, to: 1140 }] })).toMatchObject({ dnd_days: 'every_day' })
    expect(slackScheduleFor(week)).toEqual({
      dnd_enabled: true,
      dnd_days: 'custom',
      ...Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday'].flatMap((day) => [[`dnd_enabled_${day}`, 'partial'], [`dnd_before_${day}`, '09:00'], [`dnd_after_${day}`, '19:00']])),
      dnd_enabled_friday: 'partial', dnd_before_friday: '22:00', dnd_after_friday: '23:59',
      dnd_enabled_saturday: 'partial', dnd_before_saturday: '11:00', dnd_after_saturday: '14:00',
      dnd_enabled_sunday: 'all_day',
    })
  })
})

describe('hours by row', () => {
  it('Settings reads weekdays as the hours most of them have, and a row sets every day in it', () => {
    // Saved before the rows: Monday to Thursday only, Thursday later.
    const old: Hours = { days: [1, 2, 3, 4], from: 600, to: 1020, dayHours: [{ day: 4, from: 720, to: 1200 }] }
    expect(groupHours(old, 'weekdays')).toEqual({ from: 600, to: 1020 })
    expect(groupHours(old, 'saturday')).toBeUndefined()
    expect(groupHours({ days: [1, 5], from: 600, to: 1020 }, 'weekdays')).toBeUndefined()
    // A tie goes to the earlier day: Monday and Tuesday off, Wednesday and Thursday 10 to 5, Friday 9 to 7.
    expect(groupHours({ days: [3, 4, 5], from: 600, to: 1020, dayHours: [{ day: 5, from: 540, to: 1140 }] }, 'weekdays')).toBeUndefined()

    // Changing the row gives all five weekdays the shown hours with the new edge.
    expect(withGroupHours(old, 'weekdays', { to: 1080 })).toEqual({ days: [1, 2, 3, 4, 5], from: 600, to: 1080 })
    // An off Saturday turned on keeps the weekdays' other edge; a from on that edge keeps the row's length.
    const saturday = withGroupHours(old, 'saturday', { from: 660 })
    expect(groupHours(saturday, 'saturday')).toEqual({ from: 660, to: 1020 })
    expect(groupHours(withGroupHours(old, 'saturday', { from: 1020 }), 'saturday')).toEqual({ from: 1020, to: 0 })
    expect(groupHours(withGroupHours(saturday, 'weekdays', 'off'), 'weekdays')).toBeUndefined()

    // Active hours follow the same rows: Saturday 11 to 2 is active, Sunday off is away.
    const active = withGroupHours(withGroupHours({ days: [1, 2, 3, 4, 5], from: 540, to: 1140 }, 'saturday', { from: 660, to: 840 }), 'sunday', 'off')
    expect(scheduledPresence(at(SAT, 12), active)).toBe('active')
    expect(scheduledPresence(at(SAT, 15), active)).toBe('away')
    expect(scheduledPresence(at(0, 12), active)).toBe('away')
    expect(presenceLabel(at(5, 20), 'away', active)).toBe('Away until Sat 11am')
  })
})

describe('presence', () => {
  it('is active inside presence hours and away outside, apart from notification hours', () => {
    // 7pm on a Monday: notifications have stopped, Slack still shows the owner active.
    expect(inHours(at(MON, 19), notificationHours)).toBe(false)
    expect(scheduledPresence(at(MON, 19), presenceHours)).toBe('active')
    expect(scheduledPresence(at(MON, 20), presenceHours)).toBe('away')
    expect(scheduledPresence(at(SAT, 12), presenceHours)).toBe('away')
  })

  it('set by hand against the hours, lasts until the hours change it', () => {
    const work = presenceHours
    // Away by hand inside the hours lasts until they start again.
    expect(presenceLabel(at(MON, 12), 'away', work)).toBe('Away until Tue 9am')
    // Active by hand before the hours runs to their end.
    expect(presenceLabel(at(MON, 8), 'active', work)).toBe('Active until 8pm')
  })
})

describe('calendar notification starts', () => {
  // Hours are wall-clock hours on the Mac, so the product reads the host zone. The checks
  // read the answer back as a local weekday, time and day count, so they hold in any zone.
  const monday = new Date(2026, 9, 12, 8, 30)
  const hours: Hours = { days: [1], from: 540, to: 1140 }
  const local = (at: number | undefined) => {
    expect(at).toBeDefined()
    const date = new Date(at!)
    return { ...localTime(at!), days: Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date(monday).setHours(0, 0, 0, 0)) / 86_400_000) }
  }

  it('starts later the same day, or a week later once the start has passed', () => {
    expect(localTime(monday.getTime())).toEqual({ weekday: 1, minutes: 510 })
    const today = nextHoursStart(monday.getTime(), hours)
    expect(local(today)).toEqual({ weekday: 1, minutes: 540, days: 0 })
    expect(local(nextHoursStart(today!, hours))).toEqual({ weekday: 1, minutes: 540, days: 7 })
  })

  it('has no start without days or with an empty span', () => {
    expect(nextHoursStart(monday.getTime(), { ...hours, days: [] })).toBeUndefined()
    expect(nextHoursStart(monday.getTime(), { ...hours, to: 540 })).toBeUndefined()
  })

  it('uses the day on which an overnight window starts', () => {
    expect(local(nextHoursStart(monday.getTime(), { days: [1], from: 1320, to: 120 }))).toEqual({ weekday: 1, minutes: 1320, days: 0 })
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

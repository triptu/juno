import { describe, expect, it } from 'vitest'
import {
  decideNotification,
  defaultNotificationSettings,
  hoursStartSummary,
  inHours,
  nextSwitch,
  nextHoursStart,
  localTime,
  scheduledPresence,
  slackPresence,
  untilLabel,
  decideWithCause,
  pausedLabel,
  presenceLabel,
  type DecisionContext,
  type Hours,
  type LocalTime,
  type NotificationCandidate,
  type NotificationSettings,
} from '../src/index'
import { alerts, eng, hiring, leoId, maya, mayaId } from './fixtures'

const at = (weekday: LocalTime['weekday'], hour: number, minute = 0): LocalTime => ({ weekday, minutes: hour * 60 + minute })
const MON = 1
const SAT = 6

// Notifications stop at 6pm; Slack shows the owner active until 8pm (the owner's example).
const settings: NotificationSettings = {
  ...defaultNotificationSettings,
  notificationHours: { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 18 * 60 },
  presenceHours: { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 20 * 60 },
  channels: { C0INCIDENTS: 'every', [eng.id]: 'never' },
  people: { [mayaId]: 'every', U0SAM: 'never' },
}
const incidents = { id: 'C0INCIDENTS', kind: 'public', name: 'incidents' } as const
const ai: DecisionContext = { aiAssist: true, userName: (id) => ({ U0MAYA: 'Maya Chen', U0SAM: 'Sam Okafor' })[id] }
const aiOff: DecisionContext = { ...ai, aiAssist: false }

function candidate(overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
  return { channel: hiring, senderId: leoId, mentionsMe: false, at: at(MON, 12), ...overrides }
}

describe('notification decision', () => {
  const urgent = { notify: true, reason: 'asks you to approve the release before 2pm' }
  const routine = { notify: false, reason: 'an update with nothing for you to do' }

  it.each([
    ['an ignored channel holds before anything else', candidate({ channel: alerts, senderId: mayaId }), ai, undefined, { outcome: 'hold', reason: '#alerts-prod is ignored' }],
    ['a channel set to Every message notifies', candidate({ channel: incidents as never }), ai, undefined, { outcome: 'now', reason: '#incidents is set to Every message' }],
    ['a person set to Every message notifies', candidate({ senderId: mayaId }), ai, undefined, { outcome: 'now', reason: 'Maya Chen is set to Every message' }],
    ['Every message on the person wins over Never on the channel', candidate({ channel: eng, senderId: mayaId }), ai, undefined, { outcome: 'now', reason: 'Maya Chen is set to Every message' }],
    ['Every message on the channel wins over Never on the person', candidate({ channel: incidents as never, senderId: 'U0SAM' as never }), ai, undefined, { outcome: 'now', reason: '#incidents is set to Every message' }],
    ['a channel set to Never holds', candidate({ channel: eng }), ai, urgent, { outcome: 'hold', reason: '#eng is set to Never' }],
    ['a person set to Never holds', candidate({ senderId: 'U0SAM' as never }), ai, urgent, { outcome: 'hold', reason: 'Sam Okafor is set to Never' }],
    ['Every message comes through outside notification hours', candidate({ senderId: mayaId, at: at(MON, 22) }), ai, undefined, { outcome: 'now', reason: 'Maya Chen is set to Every message' }],
    ['inside hours, Juno says it needs you', candidate(), ai, urgent, { outcome: 'now', reason: 'Juno: asks you to approve the release before 2pm' }],
    ['inside hours, Juno says it can wait', candidate(), ai, routine, { outcome: 'hold', reason: 'Juno: an update with nothing for you to do' }],
    ['outside hours, what would have notified goes into the summary', candidate({ at: at(MON, 19) }), ai, urgent, { outcome: 'summary', reason: 'Outside your notification hours. Juno: asks you to approve the release before 2pm' }],
    ['outside hours, what can wait is held', candidate({ at: at(SAT, 12) }), ai, routine, { outcome: 'hold', reason: 'Juno: an update with nothing for you to do' }],
    ['AI assist off: a DM notifies', candidate({ channel: maya }), aiOff, undefined, { outcome: 'now', reason: 'AI assist is off, and DMs and mentions notify you' }],
    ['AI assist off: a mention notifies', candidate({ mentionsMe: true }), aiOff, undefined, { outcome: 'now', reason: 'AI assist is off, and DMs and mentions notify you' }],
    ['AI assist off: anything else holds', candidate(), aiOff, undefined, { outcome: 'hold', reason: 'AI assist is off, so only DMs and mentions notify you' }],
    ['AI assist off: a DM outside hours goes into the summary', candidate({ channel: maya, at: at(MON, 7) }), aiOff, undefined, { outcome: 'summary', reason: 'Outside your notification hours. AI assist is off, and DMs and mentions notify you' }],
  ] as const)('%s', (_name, message, context, judgement, expected) => {
    expect(decideNotification(message, settings, context, judgement)).toEqual(expected)
  })

  it('applies thread overrides, with Every message winning over Never anywhere', () => {
    const topicId = 't:C0HIRING:1.000001'
    const message = candidate({ topicId })
    expect(decideNotification(message, { ...settings, threads: { [topicId]: 'every' }, channels: { [message.channel.id]: 'never' } }, ai)).toMatchObject({ outcome: 'now' })
    expect(decideNotification(message, { ...settings, threads: { [topicId]: 'never' } }, ai)).toMatchObject({ outcome: 'hold' })
    expect(decideNotification({ ...message, senderId: mayaId }, { ...settings, threads: { [topicId]: 'never' } }, ai)).toMatchObject({ outcome: 'now' })
  })

  it('asks for Juno only when the settings did not decide', () => {
    expect(decideNotification(candidate(), settings, ai)).toEqual({ needsJudgement: true })
    expect(decideNotification(candidate({ at: at(SAT, 12) }), settings, ai)).toEqual({ needsJudgement: true })
    expect(decideNotification(candidate({ channel: eng }), settings, ai)).not.toEqual({ needsJudgement: true })
  })
})

describe('what decided a message', () => {
  it('names the level that decided, or the hours, or Juno', () => {
    const thread = candidate({ topicId: 't:C0HIRING:1.0' })
    const threads = { ...settings, threads: { 't:C0HIRING:1.0': 'never' as const } }
    expect(decideWithCause(thread, threads, ai)).toMatchObject({ cause: { kind: 'level', target: { kind: 'thread', id: 't:C0HIRING:1.0' } } })
    expect(decideWithCause(candidate({ senderId: mayaId }), settings, ai)).toMatchObject({ cause: { kind: 'level', target: { kind: 'person', id: mayaId } } })
    expect(decideWithCause(candidate({ channel: eng }), settings, ai)).toMatchObject({ cause: { kind: 'level', target: { kind: 'channel', id: eng.id } } })
    expect(decideWithCause(candidate({ at: at(SAT, 12) }), settings, ai, { notify: true, reason: 'asks you' })).toMatchObject({ decision: { outcome: 'summary' }, cause: { kind: 'hours' } })
    expect(decideWithCause(candidate(), settings, ai, { notify: false, reason: 'chatter' })).toEqual({ decision: { outcome: 'hold', reason: 'Juno: chatter' }, cause: { kind: 'juno' } })
  })
})

describe('the summary when notification hours start', () => {
  const summary = { outcome: 'summary', reason: '' } as const
  const hold = { outcome: 'hold', reason: '' } as const

  it('counts only messages kept for it, and names where they are', () => {
    expect(hoursStartSummary([{ decision: summary, where: '#eng' }, { decision: hold, where: '#random' }])).toEqual({ title: '1 message needs you', body: 'In #eng' })
    expect(
      hoursStartSummary([
        { decision: summary, where: '#eng' },
        { decision: summary, where: 'Maya Chen' },
        { decision: summary, where: '#eng' },
        { decision: summary, where: '#hiring' },
      ]),
    ).toEqual({ title: '4 messages need you', body: 'In #eng, Maya Chen and #hiring' })
    expect(hoursStartSummary(['#a', '#b', '#c', '#d', '#e'].map((where) => ({ decision: summary, where })))).toEqual({ title: '5 messages need you', body: 'In #a, #b, #c and 2 more' })
  })

  it('sends nothing when nothing needed the owner', () => {
    expect(hoursStartSummary([{ decision: hold, where: '#random' }])).toBeUndefined()
    expect(hoursStartSummary([])).toBeUndefined()
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

  it('sets Slack to auto when active, so an idle owner still shows away', () => {
    expect(slackPresence('active')).toBe('auto')
    expect(slackPresence('away')).toBe('away')
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

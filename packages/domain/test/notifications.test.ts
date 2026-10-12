import { describe, expect, it } from 'vitest'
import {
  decideNotification,
  decisionChip,
  defaultNotificationSettings,
  inQuietHours,
  nextDigestLabel,
  nextDigestSlot,
  ruleLabel,
  ruleMatches,
  type NotificationCandidate,
  type NotificationRule,
  type NotificationSettings,
  type RuleNames,
} from '../src/index'
import { alerts, eng, hiring, leoId, maya, mayaId } from './fixtures'

const names: RuleNames = {
  user: (id) => ({ U0MAYA: 'Maya Chen', U0LEO: 'Leo Park' })[id],
  channel: (id) => [eng, hiring, maya, alerts].find((c) => c.id === id),
}

const rules: NotificationRule[] = [
  { id: 'r1', kind: 'channel', value: 'C0INCIDENTS', action: 'now' },
  { id: 'r2', kind: 'person', value: mayaId, action: 'now' },
  { id: 'r3', kind: 'mention', value: hiring.id, action: 'now' },
  { id: 'r4', kind: 'keyword', value: 'lunch', action: 'silent' },
  { id: 'r5', kind: 'channel', value: eng.id, action: 'digest' },
]

const noon = 12 * 60
const nineAtNight = 21 * 60

function candidate(overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
  return { channel: hiring, senderId: leoId, mentionsMe: false, text: 'hello there', localMinutes: noon, ...overrides }
}

const settings: NotificationSettings = { ...defaultNotificationSettings, threshold: 80 }

describe('rules', () => {
  it('labels rules the way the Notifications page prints them', () => {
    expect(ruleLabel(rules[0]!, { ...names, channel: () => ({ id: 'C0INCIDENTS', kind: 'public', name: 'incidents' }) as never })).toBe('In #incidents')
    expect(ruleLabel(rules[1]!, names)).toBe('From Maya Chen')
    expect(ruleLabel(rules[2]!, names)).toBe('Mentions of me in hiring')
    expect(ruleLabel(rules[3]!, names)).toBe('Contains "lunch"')
    expect(ruleLabel({ id: 'x', kind: 'person', value: 'U0UNKNOWN', action: 'now' })).toBe('From U0UNKNOWN')
  })

  it('matches a person, a channel or DM, mentions of me in a channel, or a keyword', () => {
    expect(ruleMatches(rules[1]!, candidate({ senderId: mayaId }))).toBe(true)
    expect(ruleMatches(rules[1]!, candidate({ senderId: leoId }))).toBe(false)
    expect(ruleMatches({ id: 'dm', kind: 'channel', value: maya.id, action: 'now' }, candidate({ channel: maya }))).toBe(true)
    expect(ruleMatches(rules[2]!, candidate({ channel: hiring, mentionsMe: true }))).toBe(true)
    expect(ruleMatches(rules[2]!, candidate({ channel: hiring, mentionsMe: false }))).toBe(false)
    expect(ruleMatches(rules[2]!, candidate({ channel: eng, mentionsMe: true }))).toBe(false)
    expect(ruleMatches(rules[3]!, candidate({ text: 'Who wants Lunch?' }))).toBe(true)
    expect(ruleMatches(rules[3]!, candidate({ text: 'launch day' }))).toBe(false)
  })
})

describe('decision order', () => {
  it('ignored channels are silent before anything else', () => {
    expect(decideNotification(candidate({ channel: alerts, senderId: mayaId }), rules, settings, names)).toEqual({ outcome: 'silent', reason: 'Ignored channel' })
  })

  it('the first matching rule wins, top to bottom', () => {
    // Maya posts "lunch" in #eng: the person rule (r2) is above the keyword and channel rules.
    expect(decideNotification(candidate({ channel: eng, senderId: mayaId, text: 'lunch?' }), rules, settings, names)).toEqual({
      outcome: 'now',
      reason: 'Rule: From Maya Chen',
      ruleId: 'r2',
    })
    // Leo posts "lunch" in #eng: keyword (r4, silent) is above the channel rule (r5, digest).
    expect(decideNotification(candidate({ channel: eng, text: 'lunch?' }), rules, settings, names)).toMatchObject({ outcome: 'silent', ruleId: 'r4' })
  })

  it('quiet hours send to digest, unless a rule said Now', () => {
    expect(decideNotification(candidate({ localMinutes: nineAtNight }), rules, settings, names)).toEqual({ outcome: 'digest', reason: 'Quiet hours' })
    expect(decideNotification(candidate({ localMinutes: nineAtNight, senderId: mayaId }), rules, settings, names)).toMatchObject({ outcome: 'now', ruleId: 'r2' })
    // A rule set to Digest or Silent in quiet hours keeps its own outcome.
    expect(decideNotification(candidate({ localMinutes: nineAtNight, channel: eng }), rules, settings, names)).toMatchObject({ outcome: 'digest', ruleId: 'r5' })
  })

  it('with Juno off, everything else waits for a digest', () => {
    expect(decideNotification(candidate(), rules, { ...settings, aiGate: false }, names)).toEqual({ outcome: 'digest', reason: 'Juno off, waiting for digest' })
  })

  it('asks for a score only when the rules and settings did not decide', () => {
    expect(decideNotification(candidate(), rules, settings, names)).toEqual({ needsScore: true })
    expect(decideNotification(candidate({ senderId: mayaId }), rules, settings, names)).not.toEqual({ needsScore: true })
  })

  it('compares the score with the threshold, then chatter, then digest', () => {
    expect(decideNotification(candidate(), rules, settings, names, { urgent: 0.89, chatter: 0.1 })).toEqual({ outcome: 'now', reason: 'Juno · 89% urgent' })
    expect(decideNotification(candidate(), rules, settings, names, { urgent: 0.8, chatter: 0.1 })).toEqual({ outcome: 'now', reason: 'Juno · 80% urgent' })
    expect(decideNotification(candidate(), rules, settings, names, { urgent: 0.14, chatter: 0.66 })).toEqual({ outcome: 'silent', reason: 'Juno · 66% just chatter' })
    expect(decideNotification(candidate(), rules, settings, names, { urgent: 0.14, chatter: 0.2 })).toEqual({ outcome: 'digest', reason: 'Juno · 14% urgent, can wait' })
  })

  it('follows the threshold slider', () => {
    const score = { urgent: 0.6, chatter: 0.1 }
    expect(decideNotification(candidate(), rules, { ...settings, threshold: 50 }, names, score)).toMatchObject({ outcome: 'now' })
    expect(decideNotification(candidate(), rules, { ...settings, threshold: 95 }, names, score)).toMatchObject({ outcome: 'digest' })
  })
})

describe('quiet hours and digest slots', () => {
  it('handles a window that crosses midnight', () => {
    const quiet = { from: 19 * 60, to: 8 * 60 }
    expect(inQuietHours(21 * 60, quiet)).toBe(true)
    expect(inQuietHours(2 * 60, quiet)).toBe(true)
    expect(inQuietHours(8 * 60, quiet)).toBe(false)
    expect(inQuietHours(noon, quiet)).toBe(false)
    expect(inQuietHours(noon, { from: 9 * 60, to: 17 * 60 })).toBe(true)
    expect(inQuietHours(noon, { from: 9 * 60, to: 9 * 60 })).toBe(false)
    expect(inQuietHours(noon, undefined)).toBe(false)
  })

  it('finds the next digest, wrapping to tomorrow', () => {
    const times = defaultNotificationSettings.digestTimes
    expect(nextDigestSlot(9 * 60, times)).toEqual({ minutes: 10 * 60, tomorrow: false })
    expect(nextDigestSlot(13 * 60, times)).toEqual({ minutes: 16 * 60 + 30, tomorrow: false })
    expect(nextDigestSlot(17 * 60, times)).toEqual({ minutes: 10 * 60, tomorrow: true })
    expect(nextDigestSlot(noon, [])).toBeUndefined()
    expect(nextDigestLabel(14 * 60, times)).toBe('Next digest 4:30pm')
    expect(nextDigestLabel(17 * 60, times)).toBe('Next digest tomorrow 10am')
  })

  it('prints the decision chip', () => {
    expect(decisionChip({ outcome: 'now', reason: '' })).toBe('Now')
    expect(decisionChip({ outcome: 'silent', reason: '' })).toBe('Silent')
    expect(decisionChip({ outcome: 'digest', reason: '' }, 13 * 60)).toBe('1pm')
  })
})

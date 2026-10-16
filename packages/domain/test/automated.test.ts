import { describe, expect, it } from 'vitest'
import { automatedReason, classifyConversation, integrationName, junoVerdict, type Sender } from '../src'

const senders = (apps: number, people: number, you = 0): ReadonlyArray<Sender> => [
  ...Array<Sender>(apps).fill('app'),
  ...Array<Sender>(people).fill('person'),
  ...Array<Sender>(you).fill('you'),
]
const channel = (name: string, list: ReadonlyArray<Sender>) => classifyConversation({ kind: 'public', name, senders: list })

describe('integration names', () => {
  it('reads alerts, deploys, ci and notifications as words in the name', () => {
    expect(integrationName('alerts-prod')).toBe(true)
    expect(integrationName('deploy-notifications')).toBe(true)
    expect(integrationName('ci')).toBe(true)
    expect(integrationName('team_github_feed')).toBe(true)
    expect(integrationName('deploys')).toBe(true)
  })

  it('does not match a word that only contains one', () => {
    expect(integrationName('eng')).toBe(false)
    expect(integrationName('circus')).toBe(false)
    expect(integrationName('alertness-club')).toBe(false)
    expect(integrationName('product')).toBe(false)
  })
})

describe('classifying a conversation', () => {
  it('moves a channel where apps sent most of the latest messages', () => {
    expect(channel('incidents-feed', senders(9, 0))).toBe('automated')
    expect(channel('random-name', senders(8, 2))).toBe('automated')
  })

  it('needs only half from apps when the name says integration', () => {
    expect(channel('alerts-prod', senders(5, 5))).toBe('automated')
    expect(channel('team-sync', senders(5, 5))).toBe('ambiguous')
  })

  it('asks when apps send half, or a third in a channel named for an integration', () => {
    expect(channel('releases', senders(3, 3))).toBe('ambiguous')
    expect(channel('releases', senders(18, 12))).toBe('ambiguous')
    expect(channel('deploys', senders(10, 20))).toBe('ambiguous')
  })

  it('leaves people talking in All, even where an app posts a minority of the messages', () => {
    expect(channel('eng', senders(0, 30))).toBe('people')
    expect(channel('eng', senders(2, 10))).toBe('people')
    // A meeting-notes app posting after each meeting, and people discussing the notes.
    expect(channel('proj-meeting-notes', senders(9, 21))).toBe('people')
    expect(channel('proj-meeting-notes', senders(14, 16))).toBe('people')
    // An on-call channel where people work through the alerts.
    expect(channel('oncall', senders(12, 18))).toBe('people')
    expect(channel('ci', senders(1, 9))).toBe('people')
    expect(channel('alerts-team', senders(0, 8))).toBe('people')
  })

  it('leaves a channel the user wrote in alone, however much apps post there', () => {
    expect(channel('alerts-prod', senders(29, 0, 1))).toBe('people')
    expect(channel('releases', senders(18, 6, 6))).toBe('people')
  })

  it('says nothing until there are a few messages', () => {
    expect(channel('alerts-prod', senders(3, 0))).toBe('unknown')
    expect(channel('alerts-prod', senders(4, 0))).toBe('automated')
  })

  it('moves a DM with an app and never a DM with a person or a group DM', () => {
    expect(classifyConversation({ kind: 'im', name: '', partnerIsApp: true, senders: [] })).toBe('automated')
    expect(classifyConversation({ kind: 'im', name: '', senders: senders(10, 0) })).toBe('people')
    expect(classifyConversation({ kind: 'mpim', name: '', senders: senders(10, 0) })).toBe('people')
  })
})

describe("Juno's answer", () => {
  it('moves when sure it is automated, leaves it when sure it is not, and asks in between', () => {
    expect(junoVerdict(0.9)).toBe('automated')
    expect(junoVerdict(0.85)).toBe('automated')
    expect(junoVerdict(0.5)).toBe('ambiguous')
    expect(junoVerdict(0.4)).toBe('people')
    expect(junoVerdict(0.2)).toBe('people')
    expect(junoVerdict(0.05)).toBe('people')
  })
})

describe("Home's reason for asking", () => {
  it("gives Juno's reason as a sentence when Juno gave one", () => {
    expect(automatedReason({ apps: 18, of: 30, juno: 'mostly release tags from a bot.' })).toBe('Mostly release tags from a bot')
  })

  it('else says how many of the latest messages apps wrote', () => {
    expect(automatedReason({ apps: 18, of: 30 })).toBe('Apps wrote 18 of the last 30 messages')
    expect(automatedReason({ apps: 18, of: 30, juno: ' ' })).toBe('Apps wrote 18 of the last 30 messages')
    expect(automatedReason({ apps: 1, of: 4 })).toBe('An app wrote 1 of the last 4 messages')
  })

  it('says nothing when neither is known', () => {
    expect(automatedReason({})).toBeUndefined()
    expect(automatedReason({ apps: null, of: null, juno: null })).toBeUndefined()
  })
})

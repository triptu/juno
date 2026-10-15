import { describe, expect, it } from 'vitest'
import { classifyConversation, integrationName, junoVerdict, type Sender } from '../src'

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

  it('asks when apps send a fair share, or the name says integration and some app writes there', () => {
    expect(channel('releases', senders(4, 6))).toBe('ambiguous')
    expect(channel('ci', senders(1, 9))).toBe('ambiguous')
  })

  it('asks instead of moving when the user writes there too', () => {
    expect(channel('alerts-prod', senders(9, 0, 1))).toBe('ambiguous')
  })

  it('leaves people talking in All', () => {
    expect(channel('eng', senders(0, 12, 3))).toBe('people')
    expect(channel('eng', senders(2, 10))).toBe('people')
    expect(channel('alerts-team', senders(0, 8))).toBe('people')
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
    expect(junoVerdict(0.2)).toBe('people')
    expect(junoVerdict(0.05)).toBe('people')
  })
})

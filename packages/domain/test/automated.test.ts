import { describe, expect, it } from 'bun:test'
import { automatedReason, classifyConversation, integrationName, junoVerdict, movedBackReason, postingCounts, type SampledMessage, type Sender } from '../src'

/** Top-level messages, apps first, then people, then the user. */
const posts = (apps: number, people: number, you = 0): ReadonlyArray<SampledMessage> => [
  ...Array<Sender>(apps).fill('app'),
  ...Array<Sender>(people).fill('person'),
  ...Array<Sender>(you).fill('you'),
].map((sender) => ({ sender }))
/** `count` replies in a thread, all from `sender`. */
const replies = (count: number, sender: Sender): ReadonlyArray<SampledMessage> => Array.from({ length: count }, () => ({ sender, reply: true }))
const channel = (name: string, messages: ReadonlyArray<SampledMessage>) => classifyConversation({ kind: 'public', name, messages })

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
  it('moves a channel where apps start nearly every conversation', () => {
    expect(channel('incidents-feed', posts(9, 0))).toBe('automated')
    expect(channel('random-name', posts(8, 2))).toBe('automated')
    expect(channel('random-name', posts(24, 6))).toBe('automated')
  })

  it('moves a CI alerts channel, even when people reply under the alerts', () => {
    // Every alert is a top-level post; people work through them in its thread.
    const alerts = Array.from({ length: 20 }, () => [{ sender: 'app' as const }, ...replies(3, 'person')]).flat()
    expect(channel('ci-alerts', alerts)).toBe('automated')
    expect(channel('ci-alerts', [...posts(27, 3), ...replies(40, 'person')])).toBe('automated')
  })

  it('moves a channel named for an integration when people start at most three in ten, and asks above that', () => {
    expect(channel('alerts-prod', posts(7, 3))).toBe('automated')
    expect(channel('alerts-prod', posts(5, 5))).toBe('ambiguous')
    expect(channel('deploys', posts(10, 20))).toBe('ambiguous')
    expect(channel('deploys', posts(9, 21))).toBe('people')
  })

  it('asks about a mixed channel, where apps start more conversations than people but not nearly all', () => {
    expect(channel('releases', posts(18, 12))).toBe('ambiguous')
    expect(channel('team-sync', posts(6, 4))).toBe('ambiguous')
    expect(channel('team-sync', posts(23, 7))).toBe('ambiguous')
  })

  it('leaves a channel where people start most conversations in All, however much agents reply in its threads', () => {
    // People ask @Cursor or @Devin in top-level posts; the agents answer in threads, many times over.
    const asked = Array.from({ length: 12 }, () => [{ sender: 'person' as const }, ...replies(6, 'app')]).flat()
    expect(channel('eng-agents', asked)).toBe('people')
    // The old reading, every message, would have seen 72 of 84 from apps.
    expect(postingCounts(asked)).toEqual({ apps: 0, people: 12, you: 0, of: 12 })
  })

  it('leaves an AI-agent-heavy people channel in All when the agents also post now and then', () => {
    // Cursor and Devin open PRs with top-level posts; people still start most conversations.
    expect(channel('eng-agents', [...posts(12, 18), ...replies(60, 'app')])).toBe('people')
    expect(channel('eng-agents', posts(15, 15))).toBe('people')
    expect(channel('proj-meeting-notes', posts(9, 21))).toBe('people')
    expect(channel('eng', posts(0, 30))).toBe('people')
    expect(channel('ci', posts(1, 9))).toBe('people')
    expect(channel('alerts-team', posts(0, 8))).toBe('people')
  })

  it('leaves a channel where the user started a conversation, and not one where they only replied', () => {
    expect(channel('alerts-prod', posts(29, 0, 1))).toBe('people')
    expect(channel('releases', posts(18, 6, 6))).toBe('people')
    expect(channel('alerts-prod', [...posts(29, 1), ...replies(2, 'you')])).toBe('automated')
  })

  it('reads at most the latest 30 top-level messages, skipping replies in between', () => {
    const newer = [...replies(5, 'app'), ...posts(30, 0)]
    expect(postingCounts([...newer, ...posts(0, 30)])).toEqual({ apps: 30, people: 0, you: 0, of: 30 })
    expect(channel('random-name', [...newer, ...posts(0, 30)])).toBe('automated')
  })

  it('says nothing until there are a few top-level messages', () => {
    expect(channel('alerts-prod', posts(3, 0))).toBe('unknown')
    expect(channel('alerts-prod', [...posts(3, 0), ...replies(10, 'app')])).toBe('unknown')
    expect(channel('alerts-prod', posts(4, 0))).toBe('automated')
  })

  it('moves a DM with an app and never a DM with a person or a group DM', () => {
    expect(classifyConversation({ kind: 'im', name: '', partnerIsApp: true, messages: [] })).toBe('automated')
    expect(classifyConversation({ kind: 'im', name: '', messages: posts(10, 0) })).toBe('people')
    expect(classifyConversation({ kind: 'mpim', name: '', messages: posts(10, 0) })).toBe('people')
  })
})

describe("Juno's answer", () => {
  it('moves when sure it is automated, leaves it when sure it is not, and asks in between', () => {
    expect(junoVerdict(0.95)).toBe('automated')
    expect(junoVerdict(0.9)).toBe('automated')
    expect(junoVerdict(0.85)).toBe('ambiguous')
    expect(junoVerdict(0.5)).toBe('ambiguous')
    expect(junoVerdict(0.4)).toBe('people')
    expect(junoVerdict(0.2)).toBe('people')
    expect(junoVerdict(0.05)).toBe('people')
  })
})

describe("Home's reason for a move or a question", () => {
  it("gives Juno's reason as a sentence when Juno gave one", () => {
    expect(automatedReason({ apps: 18, of: 30, juno: 'mostly release tags from a bot.' })).toBe('Mostly release tags from a bot')
  })

  it('else says how many of the latest top-level messages apps wrote', () => {
    expect(automatedReason({ apps: 24, of: 30 })).toBe('Apps wrote 24 of the last 30 top-level messages')
    expect(automatedReason({ apps: 18, of: 30, juno: ' ' })).toBe('Apps wrote 18 of the last 30 top-level messages')
    expect(automatedReason({ apps: 1, of: 4 })).toBe('An app wrote 1 of the last 4 top-level messages')
  })

  it('says nothing when neither is known', () => {
    expect(automatedReason({})).toBeUndefined()
    expect(automatedReason({ apps: null, of: null, juno: null })).toBeUndefined()
  })
})

describe('the reason for moving a channel back', () => {
  it('says people start most conversations, with the counts the rule read', () => {
    expect(movedBackReason({ people: 18, you: 0, of: 30 })).toEqual({
      line: 'Moved back: people start most conversations here',
      detail: 'People wrote 18 of the last 30 top-level messages',
    })
  })

  it('says so when it was the user who started one', () => {
    expect(movedBackReason({ people: 1, you: 1, of: 30 })).toEqual({ line: 'Moved back: you start conversations here', detail: 'You wrote 1 of the last 30 top-level messages' })
  })
})

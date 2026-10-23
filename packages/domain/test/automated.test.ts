import { describe, expect, it } from 'bun:test'
import { classifyConversation, integrationName, postingCounts, type SampledMessage, type Sender } from '../src'

/** Top-level messages, apps first, then people, then the user. */
const posts = (apps: number, people: number, you = 0): ReadonlyArray<SampledMessage> => [
  ...Array<Sender>(apps).fill('app'),
  ...Array<Sender>(people).fill('person'),
  ...Array<Sender>(you).fill('you'),
].map((sender) => ({ sender }))
/** `count` replies in a thread, all from `sender`. */
const replies = (count: number, sender: Sender): ReadonlyArray<SampledMessage> => Array.from({ length: count }, () => ({ sender, reply: true }))
/** `count` top-level posts from `starter`, each with `each` replies from `replier`. */
const threads = (count: number, starter: Sender, each: number, replier: Sender): ReadonlyArray<SampledMessage> =>
  Array.from({ length: count }, () => [{ sender: starter }, ...replies(each, replier)]).flat()

describe('integration names', () => {
  it.each([
    ['alerts-prod', true],
    ['deploy-notifications', true],
    ['ci', true],
    ['team_github_feed', true],
    ['deploys', true],
    // A word that only contains one does not count.
    ['eng', false],
    ['circus', false],
    ['alertness-club', false],
    ['product', false],
  ])('%s is %p', (name, expected) => {
    expect(integrationName(name)).toBe(expected)
  })
})

describe('classifying a channel', () => {
  it.each([
    // Apps start nearly every conversation.
    ['incidents-feed', posts(9, 0), 'automated'],
    ['random-name', posts(8, 2), 'automated'],
    ['random-name', posts(24, 6), 'automated'],
    // CI alerts are top-level posts; people work through them in the thread.
    ['ci-alerts', threads(20, 'app', 3, 'person'), 'automated'],
    ['ci-alerts', [...posts(27, 3), ...replies(40, 'person')], 'automated'],
    // Named for an integration: moved when people start at most three in ten, asked above that.
    ['alerts-prod', posts(7, 3), 'automated'],
    ['alerts-prod', posts(5, 5), 'ambiguous'],
    ['deploys', posts(10, 20), 'ambiguous'],
    ['deploys', posts(9, 21), 'people'],
    // Apps start more than people, but not nearly all.
    ['releases', posts(18, 12), 'ambiguous'],
    ['team-sync', posts(6, 4), 'ambiguous'],
    ['team-sync', posts(23, 7), 'ambiguous'],
    // People ask agents in top-level posts; the agents answer in threads, many times over.
    ['eng-agents', threads(12, 'person', 6, 'app'), 'people'],
    ['eng-agents', [...posts(12, 18), ...replies(60, 'app')], 'people'],
    ['eng-agents', posts(15, 15), 'people'],
    ['proj-meeting-notes', posts(9, 21), 'people'],
    ['eng', posts(0, 30), 'people'],
    ['ci', posts(1, 9), 'people'],
    ['alerts-team', posts(0, 8), 'people'],
    // The user started a conversation; replying alone does not count.
    ['alerts-prod', posts(29, 0, 1), 'people'],
    ['releases', posts(18, 6, 6), 'people'],
    ['alerts-prod', [...posts(29, 1), ...replies(2, 'you')], 'automated'],
    // Only the latest 30 top-level messages count, skipping replies in between.
    ['random-name', [...replies(5, 'app'), ...posts(30, 0), ...posts(0, 30)], 'automated'],
    // Nothing until there are four top-level messages.
    ['alerts-prod', posts(3, 0), 'unknown'],
    ['alerts-prod', [...posts(3, 0), ...replies(10, 'app')], 'unknown'],
    ['alerts-prod', posts(4, 0), 'automated'],
  ] as const)('%s → %s (#%#)', (name, messages, expected) => {
    expect(classifyConversation({ kind: 'public', name, messages })).toBe(expected)
  })

  it('counts top-level posts only', () => {
    // Reading every message would see 72 of 84 from apps.
    expect(postingCounts(threads(12, 'person', 6, 'app'))).toEqual({ apps: 0, people: 12, you: 0, of: 12 })
    expect(postingCounts([...replies(5, 'app'), ...posts(30, 0), ...posts(0, 30)])).toEqual({ apps: 30, people: 0, you: 0, of: 30 })
  })

  it('moves a DM with an app and never a DM with a person or a group DM', () => {
    expect(classifyConversation({ kind: 'im', name: '', partnerIsApp: true, messages: [] })).toBe('automated')
    expect(classifyConversation({ kind: 'im', name: '', messages: posts(10, 0) })).toBe('people')
    expect(classifyConversation({ kind: 'mpim', name: '', messages: posts(10, 0) })).toBe('people')
  })
})

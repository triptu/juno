/** Destinations for the New chat fixtures: the conversations and threads the pickers offer. */
import type { Person, PickConversation, PickConversations, PickThread } from '@juno/contract'
import { people } from './topics'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const channel = (key: string, name: string, kind: 'public' | 'private' = 'public', empty = false): PickConversation => ({
  key,
  name,
  kind,
  tint: kind,
  channelId: key,
  mainId: `m:${key}`,
  empty,
})

const dm = (key: string, person: Person): PickConversation => ({
  key,
  name: person.name,
  kind: 'im',
  tint: 'dm',
  channelId: key,
  mainId: `m:${key}`,
  person,
  empty: false,
})

export const conversations = {
  eng: channel('C0ENG', 'eng'),
  billing: channel('C0BILLING', 'billing-ops'),
  hiring: channel('C0HIRING', 'hiring', 'private'),
  onboarding: channel('C0JONAS', 'jonas-onboarding', 'private'),
  maya: dm('D0MAYA', people.maya),
  sam: dm('D0SAM', people.sam),
  group: { key: 'G0OFFSITE', name: 'Maya, Leo', kind: 'mpim', tint: 'dm', channelId: 'G0OFFSITE', mainId: 'm:G0OFFSITE', empty: false },
  /** A person never messaged: no DM yet. */
  jonas: { key: 'u:U0JONAS', name: people.jonas.name, kind: 'im', tint: 'dm', person: people.jonas, empty: true },
  long: channel('C0LONG', 'incident-2026-10-14-payments-ledger-reconciliation-follow-up'),
} as const satisfies Record<string, PickConversation>

export const recentConversations: PickConversations = {
  recent: [conversations.eng, conversations.maya, conversations.hiring, conversations.group, conversations.billing, conversations.sam],
  people: [],
  channels: [],
}

export const jonQuery: PickConversations = {
  recent: [],
  people: [conversations.jonas, dm('D0JO', { id: 'U0JO', name: 'Jo Okafor', color: 'emerald' })],
  channels: [conversations.onboarding],
}

export const noConversations: PickConversations = { recent: [], people: [], channels: [] }

const thread = (id: string, title: string, conversation: PickConversation, replyCount: number, ago: number, now: number): PickThread => ({
  id: `t:${conversation.channelId ?? conversation.key}:${id}`,
  rootTs: id,
  title,
  replyCount,
  lastActivityAt: now - ago,
  conversation,
})

export const cutoverThreads = (now: number): ReadonlyArray<PickThread> => [
  thread('1760000000.000100', 'Postgres 16 cutover window', conversations.eng, 14, 2 * HOUR, now),
  thread('1760000000.000200', 'Cutover checklist for billing', conversations.billing, 6, DAY + HOUR, now),
  thread('1760000000.000300', 'Who owns the cutover comms?', conversations.maya, 3, 3 * DAY, now),
]

export const engThreads = (now: number): ReadonlyArray<PickThread> => [
  thread('1760000000.000100', 'Postgres 16 cutover window', conversations.eng, 14, 4 * MINUTE, now),
  thread('1760000000.000400', 'Flaky integration tests on main', conversations.eng, 1, 3 * HOUR, now),
  thread('1760000000.000500', 'A very long thread title about the replica lag dashboards and who should own the alert thresholds', conversations.eng, 22, 2 * DAY, now),
]

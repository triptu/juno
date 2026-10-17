/** Destinations for the fixtures: the conversations Home's destination list and ⌘K offer. */
import type { Person, PickConversation, PickConversations } from '@juno/contract'
import { people } from './topics'

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

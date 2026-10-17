/** Home's Recent and its composer states, for the fixtures: the people and channels the fake workspace would rank. */
import type { PickConversation } from '@juno/contract'
import { conversations } from './newChat'
import { people as who } from './topics'

const dm = (person: (typeof who)[keyof typeof who]): PickConversation => ({ key: `D:${person.id}`, name: person.name, kind: 'im', tint: 'dm', channelId: `D:${person.id}`, mainId: `m:D:${person.id}`, person, empty: false })
const channel = (key: string, name: string, icon: NonNullable<PickConversation['icon']>, color: NonNullable<PickConversation['color']>, kind: 'public' | 'private' = 'public'): PickConversation => ({ key, name, kind, tint: kind, channelId: key, mainId: `m:${key}`, icon, color, empty: false })

export const maya = conversations.maya
export const eng = channel('C0ENG', 'eng', 'code', 'emerald')

export const recentPeople: ReadonlyArray<PickConversation> = [maya, dm(who.dev), dm(who.sam), dm(who.leo), dm(who.priya)]
export const recentChannels: ReadonlyArray<PickConversation> = [
  eng,
  channel('C0HIRING', 'hiring', 'shield', 'midnight', 'private'),
  channel('C0BILLING', 'billing-ops', 'globe', 'claret'),
  channel('C0DESIGNREV', 'design-review', 'star', 'plum'),
  channel('C0INCIDENTS', 'incidents', 'bug', 'rose'),
]

/** What a first "@ma" suggests. */
export const atMa: ReadonlyArray<PickConversation> = [maya, conversations.group, { key: 'u:U0MARTA', name: 'Marta Nowak', kind: 'im', tint: 'dm', person: { id: 'U0MARTA', name: 'Marta Nowak', color: 'plum' }, empty: true }]
/** What a first "#en" suggests. */
export const hashEn: ReadonlyArray<PickConversation> = [eng, channel('C0ENGONCALL', 'eng-oncall', 'lightning', 'cyan'), channel('C0DESIGNENG', 'design-engineering', 'wrench', 'jordy')]

export const DRAFT = 'Can we move the cutover to Thursday night? Dev needs one more day on the replica check.'
export const MULTILINE = "Can we move the cutover to Thursday night?\nDev needs one more day on the replica check, and support asked for a heads-up before 6pm.\nI'll post the plan in #eng once you confirm."

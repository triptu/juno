/** Home's Recent and its composer states, for the fixtures: the people and channels the fake workspace would rank. */
import type { PickConversation } from '@juno/contract'
import { studyArt } from './artRows'
import { conversations } from './newChat'
import { art, people as who } from './topics'

const dm = (person: (typeof who)[keyof typeof who]): PickConversation => ({ key: `D:${person.id}`, name: person.name, kind: 'im', tint: 'dm', channelId: `D:${person.id}`, mainId: `m:D:${person.id}`, person, empty: false })
/** A channel with its Main's art, or the placeholder (no `recipe`) for one not drawn yet. */
const channel = (key: string, name: string, recipe?: string, kind: 'public' | 'private' = 'public'): PickConversation => ({ key, name, kind, tint: kind, channelId: key, mainId: `m:${key}`, ...(recipe === undefined ? {} : { art: recipe }), empty: false })

export const maya = conversations.maya
export const eng = channel('C0ENG', 'eng', studyArt.mainEng)

export const recentPeople: ReadonlyArray<PickConversation> = [maya, dm(who.dev), dm(who.sam), dm(who.leo), dm(who.priya)]
export const recentChannels: ReadonlyArray<PickConversation> = [
  eng,
  channel('C0HIRING', 'hiring', art.people, 'private'),
  channel('C0BILLING', 'billing-ops', art.coins),
  channel('C0DESIGNREV', 'design-review'),
  channel('C0INCIDENTS', 'incidents', art.bell),
]

/** What a first "@ma" suggests. */
export const atMa: ReadonlyArray<PickConversation> = [maya, conversations.group, { key: 'u:U0MARTA', name: 'Marta Nowak', kind: 'im', tint: 'dm', person: { id: 'U0MARTA', name: 'Marta Nowak', color: 'plum' }, empty: true }]
/** What a first "#en" suggests. */
export const hashEn: ReadonlyArray<PickConversation> = [eng, channel('C0ENGONCALL', 'eng-oncall', studyArt.oncall), channel('C0DESIGNENG', 'design-engineering', studyArt.icons)]

export const DRAFT = 'Can we move the cutover to Thursday night? Dev needs one more day on the replica check.'
export const MULTILINE = "Can we move the cutover to Thursday night?\nDev needs one more day on the replica check, and support asked for a heads-up before 6pm.\nI'll post the plan in #eng once you confirm."

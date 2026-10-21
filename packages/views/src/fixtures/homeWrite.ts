/** Home's composer states, for the fixtures: the destinations a first @ or # suggests, and drafts. */
import type { PickConversation } from '@juno/contract'
import { studyArt } from './artRows'
import { conversations } from './newChat'

/** A channel with its Main's art, or the placeholder (no `recipe`) for one not drawn yet. */
const channel = (key: string, name: string, recipe?: string): PickConversation => ({ key, name, kind: 'public', tint: 'public', channelId: key, mainId: `m:${key}`, ...(recipe === undefined ? {} : { art: recipe }), empty: false })

export const maya = conversations.maya
export const eng = channel('C0ENG', 'eng', studyArt.mainEng)

/** What a first "@ma" suggests. */
export const atMa: ReadonlyArray<PickConversation> = [maya, conversations.group, { key: 'u:U0MARTA', name: 'Marta Nowak', kind: 'im', tint: 'dm', person: { id: 'U0MARTA', name: 'Marta Nowak', color: 'plum' }, empty: true }]
/** What a first "#en" suggests. */
export const hashEn: ReadonlyArray<PickConversation> = [eng, channel('C0ENGONCALL', 'eng-oncall', studyArt.oncall), channel('C0DESIGNENG', 'design-engineering', studyArt.icons)]

export const DRAFT = 'Can we move the cutover to Thursday night? Dev needs one more day on the replica check.'
export const MULTILINE = "Can we move the cutover to Thursday night?\nDev needs one more day on the replica check, and support asked for a heads-up before 6pm.\nI'll post the plan in #eng once you confirm."

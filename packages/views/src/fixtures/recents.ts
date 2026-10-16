/** People and channels you wrote to, and composer states, for the merged Home proposals (rounds 2 and 3). */
import type { ChannelIconName } from '@juno/ui'
import type { Recent, WriteState } from '../HomeWrite'
import { people as who } from './topics'

export const dm = (person: (typeof who)[keyof typeof who], at: string, preview: string): Recent => ({ key: `D:${person.id}`, name: person.name, kind: 'im', person, at, preview })
export const channel = (id: string, name: string, icon: ChannelIconName | undefined, at: string, preview: string, kind: 'public' | 'private' = 'public'): Recent => ({
  key: id,
  name,
  kind,
  channel: { id, ...(icon === undefined ? {} : { icon }) },
  at,
  preview,
})

export const maya = dm(who.maya, '2h', 'You: Thursday works for me')
export const people: ReadonlyArray<Recent> = [
  maya,
  dm(who.dev, '4h', 'Dev: Replica lag is under a second now'),
  dm(who.sam, 'Yesterday', 'You: Sending the packet tonight'),
  dm(who.leo, 'Yesterday', 'Leo: Can you look at the offsite list?'),
  dm(who.priya, 'Mon', 'Priya: Notes from the vendor call'),
  { key: 'G:OFFSITE', name: 'Maya, Leo', kind: 'mpim', people: [who.maya, who.leo], at: 'Tue', preview: 'Maya: Wednesday afternoon then' },
]
export const eng = channel('C0ENG', 'eng', 'code', '1h', 'Dev: Booked 2–4pm. Will post results here.')
export const channels: ReadonlyArray<Recent> = [
  eng,
  channel('C0HIRING', 'hiring', 'briefcase', '3h', 'Elena: Rina finished the onsite', 'private'),
  channel('C0BILLING', 'billing-ops', 'truck', 'Yesterday', 'You: The invoice run moved to Friday'),
  channel('C0DESIGNREV', 'design-review', 'camera', 'Mon', 'Priya: Icon refresh is in'),
  channel('C0INCIDENTS', 'incidents', 'bug', 'Mon', 'Grafana: p95 back to normal'),
  channel('C0PRODUCT', 'product', 'compass', 'Sep 30', 'Maya: Proposal for Q4 is up'),
]

export const juno = (draft = '', extra: Partial<WriteState> = {}): WriteState => ({ destination: 'juno', draft, ...extra })

export const personPicker: WriteState = juno('@ma', {
  picker: {
    kind: 'person',
    active: maya.key,
    rows: [maya, people[5]!, { key: 'D:U0MARTA', name: 'Marta Nowak', kind: 'im', person: { id: 'U0MARTA', name: 'Marta Nowak', color: 'plum' }, at: '' }],
  },
})
export const channelPicker: WriteState = juno('#en', {
  picker: {
    kind: 'channel',
    active: eng.key,
    rows: [eng, channel('C0ENGONCALL', 'eng-oncall', 'lightning', '', ''), channel('C0DESIGNENG', 'design-engineering', undefined, '', '')],
  },
})
// "#eng" is part of a question for Juno: Space closed the list, the channel is a mention in the text.
export const junoHash = juno('#eng what happened today?', { marks: [{ start: 0, end: 4, look: 'channel' }] })

export const DRAFT = 'Can we move the cutover to Thursday night? Dev needs one more day on the replica check.'
export const writing: WriteState = { destination: maya, draft: DRAFT }

/** People and channels in one list, newest first, as the one-list variants order them. */
export const mixed: ReadonlyArray<Recent> = [channels[0]!, people[0]!, channels[1]!, people[1]!, people[2]!, channels[2]!, people[3]!, channels[3]!, people[4]!, channels[4]!, people[5]!, channels[5]!]

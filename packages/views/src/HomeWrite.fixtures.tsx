import type { ComponentType } from 'react'
import { defineFixtures, scene, type ChannelIconName, type FixtureFrame } from '@juno/ui'
import { homeItems, homeProps } from './fixtures/home'
import { people as who } from './fixtures/topics'
import { type HomeWriteProps, type Recent, type WriteState } from './HomeWrite'
import { HomeShelf, HomeDock } from './HomeWriteBottom'
import { HomeAddressBook, HomeInbox, HomeMosaic } from './HomeWriteCentre'
import { hueFor } from './look'

// Round 2 of the merged Home: the same nine states for each direction.


const home = homeProps

const caughtUp = home({ scene: 'caughtUp', title: 'All caught up.', line: 'Nothing is waiting on you.', items: [] })
const firstRun = home({ scene: 'midday', title: 'Hello, Tushar.', line: 'Nothing is waiting on you.', items: [] })
const writingHome = home({ line: 'Two things want you.', items: [homeItems.waiting, homeItems.resume] })

const dm = (person: (typeof who)[keyof typeof who], at: string, preview: string): Recent => ({ key: `D:${person.id}`, name: person.name, kind: 'im', person, at, preview })
const channel = (id: string, name: string, icon: ChannelIconName | undefined, at: string, preview: string, kind: 'public' | 'private' = 'public'): Recent => ({
  key: id,
  name,
  kind,
  channel: { id, ...(icon === undefined ? {} : { icon }) },
  at,
  preview,
})

const maya = dm(who.maya, '2h', 'You: Thursday works for me')
const people: ReadonlyArray<Recent> = [
  maya,
  dm(who.dev, '4h', 'Dev: Replica lag is under a second now'),
  dm(who.sam, 'Yesterday', 'You: Sending the packet tonight'),
  dm(who.leo, 'Yesterday', 'Leo: Can you look at the offsite list?'),
  dm(who.priya, 'Mon', 'Priya: Notes from the vendor call'),
  { key: 'G:OFFSITE', name: 'Maya, Leo', kind: 'mpim', people: [who.maya, who.leo], at: 'Tue', preview: 'Maya: Wednesday afternoon then' },
]
const eng = channel('C0ENG', 'eng', 'code', '1h', 'Dev: Booked 2–4pm. Will post results here.')
const channels: ReadonlyArray<Recent> = [
  eng,
  channel('C0HIRING', 'hiring', 'briefcase', '3h', 'Elena: Rina finished the onsite', 'private'),
  channel('C0BILLING', 'billing-ops', 'truck', 'Yesterday', 'You: The invoice run moved to Friday'),
  channel('C0DESIGNREV', 'design-review', 'camera', 'Mon', 'Priya: Icon refresh is in'),
  channel('C0INCIDENTS', 'incidents', 'bug', 'Mon', 'Grafana: p95 back to normal'),
  channel('C0PRODUCT', 'product', 'compass', 'Sep 30', 'Maya: Proposal for Q4 is up'),
]

const juno = (draft = '', extra: Partial<WriteState> = {}): WriteState => ({ destination: 'juno', draft, ...extra })

const personPicker: WriteState = juno('@ma', {
  picker: {
    kind: 'person',
    active: maya.key,
    rows: [maya, people[5]!, { key: 'D:U0MARTA', name: 'Marta Nowak', kind: 'im', person: { id: 'U0MARTA', name: 'Marta Nowak', color: 'plum' }, at: '' }],
  },
})
const channelPicker: WriteState = juno('#en', {
  picker: {
    kind: 'channel',
    active: eng.key,
    rows: [eng, channel('C0ENGONCALL', 'eng-oncall', 'lightning', '', ''), channel('C0DESIGNENG', 'design-engineering', undefined, '', '')],
  },
})
// "#eng" is part of a question for Juno: Space closed the list, the channel is a mention in the text.
const junoHash = juno('#eng what happened today?', { marks: [{ start: 0, end: 4, look: 'channel' }] })

const DRAFT = 'Can we move the cutover to Thursday night? Dev needs one more day on the replica check.'
const writing: WriteState = { destination: maya, draft: DRAFT }
// The token direction carries the destination as the text's first word.
const writingToken: WriteState = { destination: maya, draft: `Maya Chen ${DRAFT}`, marks: [{ start: 0, end: 9, look: 'person', hue: hueFor(who.maya.color, who.maya.id) }] }

const sentPeople: ReadonlyArray<Recent> = [{ ...maya, sent: true, at: 'now' }, ...people.slice(1)]

const frame = { width: 1056, height: 720, padded: false }
const narrow: FixtureFrame = { width: 560, height: 720, padded: false }

const shot = (View: ComponentType<HomeWriteProps>, props: HomeWriteProps, at?: FixtureFrame) => scene<HomeWriteProps>(() => <View {...props} />, at)

function states(View: ComponentType<HomeWriteProps>, token = false, refined = false) {
  const base = { home: home(), people, channels, write: juno(), refined }
  return {
    States: {
      'items-waiting': shot(View, base),
      'caught-up': shot(View, { ...base, home: caughtUp }),
      'at-person': shot(View, { ...base, home: writingHome, write: personPicker }),
      'at-channel': shot(View, { ...base, home: writingHome, write: channelPicker }),
      'juno-hash': shot(View, { ...base, home: writingHome, write: junoHash }),
      writing: shot(View, { ...base, home: writingHome, write: token ? writingToken : writing }),
      sent: shot(View, { ...base, home: writingHome, people: sentPeople }),
      'first-run': shot(View, { home: firstRun, people: [], channels: [], write: juno(), refined }),
      narrow: shot(View, base, narrow),
    },
  }
}

export const addressBook = defineFixtures(HomeAddressBook, states(HomeAddressBook), frame)
export const shelf = defineFixtures(HomeShelf, states(HomeShelf), frame)
export const mosaic = defineFixtures(HomeMosaic, states(HomeMosaic, true), frame)
export const inbox = defineFixtures(HomeInbox, states(HomeInbox), frame)
export const dock = defineFixtures(HomeDock, states(HomeDock), frame)

export const addressBookRefined = defineFixtures(HomeAddressBook, states(HomeAddressBook, false, true), frame)
export const shelfRefined = defineFixtures(HomeShelf, states(HomeShelf, false, true), frame)

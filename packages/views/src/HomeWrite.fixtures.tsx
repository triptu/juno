import type { ComponentType } from 'react'
import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { homeItems, homeProps } from './fixtures/home'
import { channelPicker, channels, DRAFT, juno, junoHash, maya, people, personPicker, writing } from './fixtures/recents'
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

import type { ComponentType } from 'react'
import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { homeItems, homeProps } from './fixtures/home'
import { conversations, cutoverThreads, recentConversations } from './fixtures/newChat'
import { NOW } from './fixtures/topics'
import { HomeOneField, HomeFoot, HomeSplit, type MergedProps } from './HomeMerged'

// Proposals for Home merged with New chat: the same four states for each direction.


const home = homeProps

const caughtUp = home({ scene: 'caughtUp', title: 'All caught up.', line: 'Nothing is waiting on you.', items: [] })
const firstRun = home({ scene: 'midday', title: 'Hello, Tushar.', line: 'Nothing is waiting on you.', items: [] })
const frequent = recentConversations.recent
const DRAFT = 'Can we move the cutover to Thursday night? Dev needs one more day on the replica check.'

const shot = (View: ComponentType<MergedProps>, props: MergedProps, frame?: FixtureFrame) => scene<MergedProps>(() => <View {...props} />, frame)

function states(View: ComponentType<MergedProps>, writing: Partial<MergedProps>, narrow?: FixtureFrame) {
  const at = (props: MergedProps, frame?: FixtureFrame) => shot(View, props, frame)
  return {
    States: {
      'items-waiting': at({ home: home(), frequent, now: NOW }),
      'caught-up': at({ home: caughtUp, frequent, now: NOW }),
      writing: at({ home: home({ line: 'Two things want you.', items: [homeItems.waiting, homeItems.resume] }), frequent, draft: DRAFT, now: NOW, ...writing }),
      'first-run': at({ home: firstRun, frequent: [], now: NOW }),
    },
    ...(narrow === undefined ? {} : { Window: { narrow: at({ home: home(), frequent, now: NOW }, narrow) } }),
  }
}

const frame = { width: 1056, height: 720, padded: false }

export const oneField = defineFixtures(HomeOneField, states(HomeOneField, { conversation: conversations.maya }, { width: 640, height: 720, padded: false }), frame)
export const foot = defineFixtures(HomeFoot, states(HomeFoot, { conversation: conversations.eng, thread: cutoverThreads(NOW)[0] }, { width: 640, height: 720, padded: false }), frame)
export const split = defineFixtures(HomeSplit, states(HomeSplit, { conversation: conversations.eng }, { width: 720, height: 900, padded: false }), frame)

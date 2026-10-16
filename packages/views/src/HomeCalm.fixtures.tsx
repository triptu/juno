import type { ComponentType } from 'react'
import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { homeItems } from './fixtures/home'
import { channels, juno, maya, people, personPicker, writing } from './fixtures/recents'
import { NOW } from './fixtures/topics'
import { HomeCalmCentre, HomeCalmFoot, type CalmProps } from './HomeCalm'

// Round 4 of the merged Home: the same states for both layouts.

const morning: CalmProps = {
  title: 'Morning, Tushar.',
  scene: 'morning',
  items: [homeItems.waiting, homeItems.resume, homeItems.moved],
  now: NOW,
  people,
  channels,
  write: juno(),
}
const caughtUp: CalmProps = { ...morning, title: 'All caught up.', scene: 'caughtUp', items: [] }
const two = { ...morning, items: [homeItems.waiting, homeItems.resume] }

// Three lines: the chip stays on the first, the send button on the last.
const MULTILINE = "Can we move the cutover to Thursday night?\nDev needs one more day on the replica check, and support asked for a heads-up before 6pm.\nI'll post the plan in #eng once you confirm."

const frame = { width: 1056, height: 720, padded: false }
const narrow: FixtureFrame = { width: 560, height: 720, padded: false }

const shot = (View: ComponentType<CalmProps>, props: CalmProps, at?: FixtureFrame) => scene<CalmProps>(() => <View {...props} />, at)

const states = (View: ComponentType<CalmProps>) => ({
  States: {
    'items-waiting': shot(View, morning),
    'caught-up': shot(View, caughtUp),
    writing: shot(View, { ...two, write: writing }),
    'writing-multiline': shot(View, { ...two, write: { destination: maya, draft: MULTILINE } }),
    'at-person': shot(View, { ...two, write: personPicker }),
    narrow: shot(View, morning, narrow),
    'narrow-caught-up': shot(View, caughtUp, narrow),
    'narrow-multiline': shot(View, { ...two, write: { destination: maya, draft: MULTILINE } }, narrow),
  },
})

export const calmCentre = defineFixtures(HomeCalmCentre, states(HomeCalmCentre), frame)
export const calmFoot = defineFixtures(HomeCalmFoot, states(HomeCalmFoot), frame)

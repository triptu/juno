import type { ComponentType } from 'react'
import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { homeItems } from './fixtures/home'
import { channelPicker, channels, juno, junoHash, mixed, people, personPicker, writing } from './fixtures/recents'
import { NOW } from './fixtures/topics'
import { QuietColumns, QuietList, QuietNames, QuietPills, type QuietProps } from './HomeQuiet'

// Round 3 of the merged Home: the same five states for each variant.

const waiting = [homeItems.waiting, homeItems.resume, homeItems.moved]
const two = [homeItems.waiting, homeItems.resume]
const base: QuietProps = { items: waiting, now: NOW, scene: 'caughtUp', people, channels, mixed, write: juno() }

const frame = { width: 1056, height: 720, padded: false }
const narrow: FixtureFrame = { width: 560, height: 720, padded: false }

const shot = (View: ComponentType<QuietProps>, props: QuietProps, at?: FixtureFrame) => scene<QuietProps>(() => <View {...props} />, at)

const states = (View: ComponentType<QuietProps>, refined = false) => ({
  States: {
    'items-waiting': shot(View, { ...base, refined }),
    'caught-up': shot(View, { ...base, items: [], refined }),
    'at-person': shot(View, { ...base, items: two, write: personPicker, refined }),
    writing: shot(View, { ...base, items: two, write: writing, refined }),
    narrow: shot(View, { ...base, refined }, narrow),
    ...(refined ? { 'juno-hash': shot(View, { ...base, items: two, write: junoHash, refined }), 'at-channel': shot(View, { ...base, items: two, write: channelPicker, refined }), 'first-run': shot(View, { ...base, items: [], people: [], channels: [], mixed: [], refined }), tiny: shot(View, { ...base, refined }, { width: 400, height: 720, padded: false }) } : {}),
  },
})

export const quietColumns = defineFixtures(QuietColumns, states(QuietColumns), frame)
export const quietList = defineFixtures(QuietList, states(QuietList), frame)
export const quietPills = defineFixtures(QuietPills, states(QuietPills), frame)
export const quietNames = defineFixtures(QuietNames, states(QuietNames), frame)
export const quietColumnsRefined = defineFixtures(QuietColumns, states(QuietColumns, true), frame)

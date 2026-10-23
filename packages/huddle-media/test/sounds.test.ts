import { expect, it } from 'bun:test'
import { huddleSounds, type SoundView } from '../src/sounds.ts'

const out: SoundView = { own: 'out', attendeeId: null, others: [] }
const view = (own: SoundView['own'], others: ReadonlyArray<string> | null = [], attendeeId = 'a1'): SoundView => ({ own, attendeeId, others })
const people = (count: number) => Array.from({ length: count }, (_, index) => `U${index}`)

// [what happened, the view before, the view after, the sounds]
it.each<[string, SoundView, SoundView, ReadonlyArray<string>]>([
  // The user's own call.
  ['the call is connecting', out, view('connecting'), []],
  ['the call connects', view('connecting'), view('connected', ['U1']), ['join']],
  ['the call drops', view('connected'), view('reconnecting'), []],
  ['the call comes back after a drop', view('reconnecting'), view('connected'), []],
  ['the call ends', view('connected', ['U1']), out, ['leave']],
  ['the call ends while reconnecting', view('reconnecting'), out, ['leave']],
  ['a call that never connected ends', view('connecting'), out, []],
  // Other people.
  ['someone joins', view('connected', ['U1']), view('connected', ['U1', 'U2']), ['join']],
  ['someone leaves', view('connected', ['U1', 'U2']), view('connected', ['U2']), ['leave']],
  ['nobody changes', view('connected', ['U1']), view('connected', ['U1']), []],
  ['the engine first names the people already there', view('connected', null), view('connected', ['U1', 'U2']), []],
  // A new attendee is a new call: the old one leaves, then the new one joins.
  ['a new attendee starts connecting', view('connected', ['U1'], 'a1'), view('connecting', null, 'a2'), ['leave']],
  ['the new attendee connects', view('connecting', null, 'a2'), view('connected', ['U1'], 'a2'), ['join']],
  // Past eight people, other people come and go quietly; the user's own call does not.
  ['a seventh person joins', view('connected', people(6)), view('connected', people(7)), ['join']],
  ['an eighth person joins', view('connected', people(7)), view('connected', people(8)), []],
  ['someone leaves eight', view('connected', people(8)), view('connected', people(7)), []],
  ['the user joins twenty', view('connecting'), view('connected', people(20)), ['join']],
  ['the user leaves twenty', view('connected', people(20)), out, ['leave']],
])('%s', (_, before, after, sounds) => {
  expect(huddleSounds(before, after)).toEqual<ReadonlyArray<string>>(sounds)
})

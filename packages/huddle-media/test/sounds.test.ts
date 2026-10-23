import { describe, expect, it } from 'bun:test'
import { huddleSounds, type SoundView } from '../src/sounds.ts'

const out: SoundView = { own: 'out', attendeeId: null, others: [] }
const view = (own: SoundView['own'], others: ReadonlyArray<string> | null = [], attendeeId = 'a1'): SoundView => ({ own, attendeeId, others })
const people = (count: number) => Array.from({ length: count }, (_, index) => `U${index}`)

describe('huddle sounds', () => {
  it('plays the join sound when the user’s own call connects, not while it connects', () => {
    expect(huddleSounds(out, view('connecting'))).toEqual([])
    expect(huddleSounds(view('connecting'), view('connected', ['U1']))).toEqual(['join'])
  })

  it('plays nothing when the call comes back after a drop', () => {
    expect(huddleSounds(view('connected'), view('reconnecting'))).toEqual([])
    expect(huddleSounds(view('reconnecting'), view('connected'))).toEqual([])
  })

  it('plays the leave sound when the user’s call ends, and nothing for a call that never connected', () => {
    expect(huddleSounds(view('connected', ['U1']), out)).toEqual(['leave'])
    expect(huddleSounds(view('reconnecting'), out)).toEqual(['leave'])
    expect(huddleSounds(view('connecting'), out)).toEqual([])
  })

  it('plays the join and leave sounds as other people come and go', () => {
    expect(huddleSounds(view('connected', ['U1']), view('connected', ['U1', 'U2']))).toEqual(['join'])
    expect(huddleSounds(view('connected', ['U1', 'U2']), view('connected', ['U2']))).toEqual(['leave'])
    expect(huddleSounds(view('connected', ['U1']), view('connected', ['U1']))).toEqual([])
  })

  it('makes no sound for the people already there once the engine names them', () => {
    expect(huddleSounds(view('connected', null), view('connected', ['U1', 'U2']))).toEqual([])
  })

  it('treats a new attendee as a new call: the old one leaves, then the new one joins', () => {
    expect(huddleSounds(view('connected', ['U1'], 'a1'), view('connecting', null, 'a2'))).toEqual(['leave'])
    expect(huddleSounds(view('connecting', null, 'a2'), view('connected', ['U1'], 'a2'))).toEqual(['join'])
  })

  it('keeps other people’s joins and leaves quiet past eight people, but not the user’s own', () => {
    expect(huddleSounds(view('connected', people(6)), view('connected', people(7)))).toEqual(['join'])
    expect(huddleSounds(view('connected', people(7)), view('connected', people(8)))).toEqual([])
    expect(huddleSounds(view('connected', people(8)), view('connected', people(7)))).toEqual([])
    expect(huddleSounds(view('connecting'), view('connected', people(20)))).toEqual(['join'])
    expect(huddleSounds(view('connected', people(20)), out)).toEqual(['leave'])
  })
})

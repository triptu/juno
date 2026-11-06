// The page's side of the hand-off (specs/huddle.qnt, `receive`): credentials from `huddle.start` and the
// values of `huddle.call` reach the page in no fixed order, and the call may have moved on by the time the
// credentials land. Whatever the order, the page starts the session when the call names its attendee, and
// otherwise acknowledges the credentials so the engine's leave for them clears.
import { describe, expect, it } from 'bun:test'
import type { HuddleCall } from '@juno/contract'
import { moveWith, noHold, type HandOff, type PageHold } from '../src/renderer/containers/huddle/handOff'

const creds = (attendeeId: string): HandOff => ({ attendeeId, credentials: { meeting: {}, attendee: {} } })

const call = (phase: HuddleCall['phase'], attendeeId: string | null, channelId = 'C0ENG', waitingFor: HuddleCall['waitingFor'] = null): HuddleCall => ({
  phase,
  channelId,
  callId: attendeeId === null ? null : 'R1',
  attendeeId,
  participants: [],
  startedAt: null,
  joinedAt: null,
  connection: null,
  muted: false,
  ended: null,
  waitingFor,
})

/** The page sees `calls` in order, with the credentials landing after the first `before` of them. */
function play(before: number, calls: ReadonlyArray<HuddleCall>, handOff: HandOff) {
  let state: PageHold = noHold
  const started: Array<string> = []
  const left: Array<number> = []
  const step = (value: HuddleCall, at: number) => {
    const move = moveWith(state, value)
    state = move.next
    if (move.start !== undefined) started.push(move.start.attendeeId)
    if (move.leave) left.push(at)
  }
  calls.slice(0, before).forEach(step)
  state = { ...state, pending: handOff }
  // Credentials in hand: the page acts on the call it has, as it does on each later value.
  step(calls[before - 1] ?? call('idle', null), before - 1)
  calls.slice(before).forEach((value, index) => step(value, before + index))
  return { state, started, left }
}

describe('credentials that land', () => {
  it('before the call names their attendee wait for it, then start the session', () => {
    const { state, started } = play(1, [call('joining', null), call('joined', 'A')], creds('A'))
    expect(started).toEqual(['A'])
    expect(state).toEqual({ pending: undefined, holding: 'A', received: 'A', named: 'A' })
  })

  it('after Leave moved the call past their attendee are acknowledged, and nothing starts', () => {
    const { state, started } = play(3, [call('joining', null), call('joined', 'A'), call('leaving', null)], creds('A'))
    expect(started).toEqual([])
    expect(state).toEqual({ pending: undefined, holding: null, received: 'A', named: 'A' })
  })

  it('after Switch moved the call to another channel are acknowledged, so that join can go out', () => {
    const { state, started } = play(3, [call('joining', null), call('joined', 'A'), call('joining', null, 'D0MAYA', 'lastCall')], creds('A'))
    expect(started).toEqual([])
    expect(state).toEqual({ pending: undefined, holding: null, received: 'A', named: 'A' })
  })

  it('once the call has ended or names someone else are acknowledged', () => {
    const acknowledged = { pending: undefined, holding: null, received: 'A', named: 'A' }
    expect(play(2, [call('joined', 'A'), call('idle', null)], creds('A')).state).toEqual(acknowledged)
    expect(play(2, [call('joined', 'A'), call('joined', 'B')], creds('A')).state).toEqual({ ...acknowledged, named: 'B' })
  })
})

it('the session stops when the call no longer names its attendee, and the next credentials start again', () => {
  const { state, started, left } = play(2, [call('joining', null), call('joined', 'A'), call('leaving', null), call('idle', null)], creds('A'))
  expect(started).toEqual(['A'])
  expect(left).toEqual([2, 3])
  const next = moveWith({ ...state, holding: null, pending: creds('B') }, call('joined', 'B'))
  expect(next.start?.attendeeId).toBe('B')
  expect(next.leave).toBe(false)
})

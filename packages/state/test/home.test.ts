import { describe, expect, it } from 'bun:test'
import type { HomeItem } from '@juno/contract'
import { holdHome, homeItemLimit } from '../src/home'
import { homeGreeting, homeScene } from '../src/homeScene'

// 2026-10-14 is a Wednesday, 2026-10-16 a Friday; local time.
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 30)
const greet = (now: Date) => homeGreeting({ now, firstName: 'Tushar', caughtUp: false })
const item = (id: string, aiTitle?: string): HomeItem => ({ id, kind: 'waiting', title: 'Elena asked you something', topics: [], ...(aiTitle === undefined ? {} : { aiTitle }) })

describe('Home copy and scene', () => {
  it('greets by the time of day, and with Happy Friday on Friday until late', () => {
    expect(greet(at(14, 8))).toEqual({ title: 'Morning, Tushar.' })
    expect(greet(at(14, 13)).title).toBe('Hello, Tushar.')
    expect(greet(at(14, 19)).title).toBe('Evening, Tushar.')
    expect(greet(at(14, 23)).title).toBe('Still up, Tushar.')
    expect(greet(at(16, 9)).title).toBe('Happy Friday, Tushar.')
    expect(greet(at(16, 23)).title).toBe('Still up, Tushar.')
  })

  it('drops the name when there is none, says when you are caught up, and never counts the rows', () => {
    expect(homeGreeting({ now: at(14, 8), caughtUp: false })).toEqual({ title: 'Morning.' })
    expect(homeGreeting({ now: at(14, 8), firstName: 'Tushar', caughtUp: true })).toEqual({ title: 'All caught up.' })
  })

  it('picks caught up first, then Friday, then the time of day', () => {
    expect(homeScene({ now: at(14, 8), caughtUp: true, firstVisitToday: true })).toBe('caughtUp')
    expect(homeScene({ now: at(16, 9), caughtUp: false, firstVisitToday: false })).toBe('friday')
    expect(homeScene({ now: at(14, 8), caughtUp: false, firstVisitToday: false })).toBe('morning')
    expect(homeScene({ now: at(14, 23), caughtUp: false, firstVisitToday: true })).toBe('night')
  })

  it('shows a season only on the first visit of a picked day, never two days running', () => {
    const seasonal: Array<number> = []
    for (let day = 1; day <= 31; day++) {
      const now = new Date(2026, 9, day, 9, 0)
      if (homeScene({ now, caughtUp: false, firstVisitToday: true }) === 'autumn') seasonal.push(day)
      expect(['morning', 'friday']).toContain(homeScene({ now, caughtUp: false, firstVisitToday: false }))
    }
    expect(seasonal.length).toBeGreaterThan(0)
    expect(seasonal.length).toBeLessThan(15)
    expect(seasonal.some((day, index) => seasonal[index + 1] === day + 1)).toBe(false)
  })

  it('caps the rows at two on a short window, and one there while the welcome card shows', () => {
    expect(homeItemLimit(800)).toBe(3)
    expect(homeItemLimit(560)).toBe(2)
    expect(homeItemLimit(800, true)).toBe(3)
    expect(homeItemLimit(480, true)).toBe(1)
  })
})

describe('holdHome', () => {
  const ids = (items: ReadonlyArray<HomeItem>) => items.map((row) => row.id)
  const none = new Set<string>()

  it('keeps the rows in their places with their new title lines, and makes a new item wait', () => {
    const shown = [item('a'), item('b')]
    const held = holdHome(shown, [item('c'), item('b'), item('a', 'Elena wants a call by Friday')], none, 3)
    expect(held.map((row) => [row.id, row.aiTitle])).toEqual([
      ['a', 'Elena wants a call by Friday'],
      ['b', undefined],
    ])
  })

  it('keeps a row that went elsewhere, and returns the rows shown when nothing changed', () => {
    const shown = [item('a'), item('b')]
    expect(holdHome(shown, [item('b')], none, 3)).toEqual(shown)
    expect(holdHome(shown, shown, none, 3)).toBe(shown)
  })

  it('takes a row the user acted on away at once, closes the gap and fills the free place with the next item', () => {
    const shown = [item('a'), item('b'), item('c')]
    expect(ids(holdHome(shown, [item('b'), item('c'), item('d')], new Set(['a']), 3))).toEqual(['b', 'c', 'd'])
    expect(ids(holdHome(shown, [item('b'), item('c')], new Set(['a']), 3))).toEqual(['b', 'c'])
  })

  it('puts a row back by rank when its action is undone', () => {
    const shown = [item('b'), item('c')]
    expect(ids(holdHome(shown, [item('a'), item('b'), item('c')], new Set(['a']), 3))).toEqual(['a', 'b', 'c'])
  })
})

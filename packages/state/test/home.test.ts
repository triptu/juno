import { describe, expect, it } from 'vitest'
import type { HomeItem, HomeView } from '@juno/contract'
import { freezeHome, homeItemLimit } from '../src/home'
import { homeGreeting, homeScene } from '../src/homeScene'

// 2026-10-14 is a Wednesday, 2026-10-16 a Friday; local time.
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 30)
const greet = (now: Date) => homeGreeting({ now, firstName: 'Tushar', caughtUp: false })
const item = (id: string, aiTitle?: string): HomeItem => ({ id, kind: 'waiting', title: 'Elena asked you something', topics: [], ...(aiTitle === undefined ? {} : { aiTitle }) })
const view = (...items: HomeItem[]): HomeView => ({ items, unread: true, ready: true, firstSync: false })

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

describe('freezeHome', () => {
  it('takes art drawn after Home appeared', () => {
    const topic = { id: 't:C0ENG:1.000001', title: 'Postgres 16 migration plan', place: 'eng' }
    const shown = view({ ...item('a'), topics: [topic] })
    const later = freezeHome(shown, view({ ...item('a'), topics: [{ ...topic, art: '<svg/>' }] }))
    expect(later.items[0]!.topics[0]!.art).toBe('<svg/>')
  })

  it('keeps the rows it showed and takes only their new title lines', () => {
    const shown = view(item('a'), item('b'))
    expect(freezeHome(shown, view(item('b'), item('c')))).toBe(shown)
    const later = freezeHome(shown, view(item('c'), item('a', 'Elena wants a call by Friday')))
    expect(later.items.map((row) => [row.id, row.aiTitle])).toEqual([
      ['a', 'Elena wants a call by Friday'],
      ['b', undefined],
    ])
  })
})

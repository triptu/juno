import { describe, expect, it } from 'bun:test'
import { statusUntil } from '../src/index'

// Local times, as the status sheet and the tooltip read them.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)
const NOW = at(18, 10) // Wednesday 18 November, 10am

describe('until', () => {
  it('names a time today by its clock and another day by its short name', () => {
    expect(statusUntil(at(18, 17, 30).getTime(), NOW)).toBe('until 5:30pm')
    expect(statusUntil(at(19, 9).getTime(), NOW)).toBe('until Thu 9am')
    expect(statusUntil(at(20, 9).getTime(), NOW)).toBe('until Fri 9am')
  })

  it('reads an end at 23:59 or at midnight as the end of a day, midnight as the day before', () => {
    expect(statusUntil(at(18, 23, 59).getTime(), NOW)).toBe('until today')
    expect(statusUntil(at(19, 0).getTime(), NOW)).toBe('until today')
    expect(statusUntil(at(21, 0).getTime(), NOW)).toBe('until Fri')
    expect(statusUntil(at(30, 0).getTime(), NOW)).toBe('until Nov 29')
  })
})

import { describe, expect, it } from 'vitest'
import { clockTime, hourLabel, messageTime, relativeTime } from '../src/index'
import { DAY, HOUR, NOW } from './fixtures'

const MINUTE = 60_000

describe('relative time', () => {
  it.each([
    [0, 'now'],
    [30_000, 'now'],
    [4 * MINUTE, '4m'],
    [59 * MINUTE, '59m'],
    [60 * MINUTE, '1h'],
    [2 * HOUR + 10 * MINUTE, '2h'],
    [23 * HOUR, '23h'],
    [24 * HOUR, 'Yesterday'],
    [47 * HOUR, 'Yesterday'],
    [48 * HOUR, '2d'],
    [3 * DAY + 5 * HOUR, '3d'],
    [13 * DAY, '13d'],
    [14 * DAY, '2w'],
    [30 * DAY, '4w'],
  ])('%d ms ago → %s', (ago, expected) => {
    expect(relativeTime(NOW - ago, NOW)).toBe(expected)
  })

  it('never goes negative for a clock slightly ahead', () => {
    expect(relativeTime(NOW + 5000, NOW)).toBe('now')
  })

  it('is tabular-friendly: digits and a unit, no spaces', () => {
    for (const ago of [MINUTE, HOUR, 3 * DAY, 20 * DAY]) expect(relativeTime(NOW - ago, NOW)).toMatch(/^\d+[mhdw]$/)
  })
})

describe('message time', () => {
  const tz = { timeZone: 'UTC' }
  it('shows the clock the same day, Yesterday, the weekday within a week, then the date', () => {
    expect(messageTime(Date.UTC(2026, 9, 12, 9, 12), NOW, tz)).toBe('9:12')
    expect(messageTime(Date.UTC(2026, 9, 12, 13, 45), NOW, tz)).toBe('13:45')
    expect(messageTime(NOW - DAY, NOW, tz)).toBe('Yesterday')
    expect(messageTime(Date.UTC(2026, 9, 10, 20, 0), NOW, tz)).toBe('Sat')
    expect(messageTime(Date.UTC(2026, 9, 3, 20, 0), NOW, tz)).toBe('Oct 3')
    expect(messageTime(Date.UTC(2025, 9, 3, 20, 0), NOW, tz)).toBe('Oct 3, 2025')
  })

  it('respects the calendar day in the given time zone', () => {
    // 23:30 in Los Angeles on the 11th is 06:30 UTC on the 12th.
    const at = Date.UTC(2026, 9, 12, 6, 30)
    expect(messageTime(at, NOW, { timeZone: 'America/Los_Angeles' })).toBe('Yesterday')
    expect(messageTime(at, NOW, tz)).toBe('6:30')
  })

  it('formats log times with two digits', () => {
    expect(clockTime(Date.UTC(2026, 9, 12, 9, 5), tz)).toBe('09:05')
  })
})

describe('hour labels', () => {
  it.each([
    [0, '12am'],
    [8 * 60, '8am'],
    [10 * 60, '10am'],
    [12 * 60, '12pm'],
    [13 * 60, '1pm'],
    [16 * 60 + 30, '4:30pm'],
    [19 * 60, '7pm'],
    [23 * 60 + 59, '11:59pm'],
  ])('%d → %s', (minutes, label) => {
    expect(hourLabel(minutes)).toBe(label)
  })
})

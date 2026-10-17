import { describe, expect, it } from 'vitest'
import { slackScheduleFor, slackScheduleMatches, slackScheduleSnapshot } from '../src/index'

describe("Slack's schedule from notification hours", () => {
  it('Monday to Friday, 9 to 7, is Slack weekdays paused from 19:00 to 09:00', () => {
    expect(slackScheduleFor({ days: [1, 2, 3, 4, 5], from: 540, to: 1140 })).toEqual({
      dnd_enabled: true, dnd_days: 'weekdays', dnd_start_hour: '19:00', dnd_end_hour: '09:00',
    })
  })

  it('every day keeps the times as they are, also across midnight', () => {
    expect(slackScheduleFor({ days: [0, 1, 2, 3, 4, 5, 6], from: 1350, to: 90 })).toEqual({
      dnd_enabled: true, dnd_days: 'every_day', dnd_start_hour: '01:30', dnd_end_hour: '22:30',
    })
  })

  it('other days are custom: hours on the chosen days, no notifications on the rest', () => {
    const prefs = slackScheduleFor({ days: [1, 3], from: 600, to: 1020 })
    expect(prefs).toMatchObject({
      dnd_days: 'custom',
      dnd_enabled_monday: 'partial', dnd_before_monday: '10:00', dnd_after_monday: '17:00',
      dnd_enabled_wednesday: 'partial',
      dnd_enabled_tuesday: 'all_day', dnd_enabled_sunday: 'all_day',
    })
    expect(prefs).not.toHaveProperty('dnd_before_tuesday')
  })

  it('a custom span that crosses midnight stops at 23:59, and no hours pause every day', () => {
    expect(slackScheduleFor({ days: [6], from: 1200, to: 120 })).toMatchObject({ dnd_before_saturday: '20:00', dnd_after_saturday: '23:59' })
    const none = slackScheduleFor({ days: [1, 2, 3, 4, 5], from: 540, to: 540 })
    expect(Object.entries(none).filter(([key]) => key.startsWith('dnd_enabled_')).map(([, value]) => value)).toEqual(Array(7).fill('all_day'))
  })

  it('matches times with or without the leading zero, and ignores prefs the target does not name', () => {
    const target = slackScheduleFor({ days: [1, 2, 3, 4, 5], from: 540, to: 1140 })
    expect(slackScheduleMatches({ ...target, dnd_end_hour: '9:00', dnd_before_monday: '7:00' }, target)).toBe(true)
    expect(slackScheduleMatches({ ...target, dnd_enabled: false }, target)).toBe(false)
    expect(slackScheduleMatches({}, target)).toBe(false)
  })

  it('the snapshot keeps only the schedule, and a schedule never set as off', () => {
    expect(slackScheduleSnapshot({ dnd_days: 'every_day', dnd_start_hour: '22:00', dnd_end_hour: '8:00', tz: 'x' })).toEqual({
      dnd_enabled: false, dnd_days: 'every_day', dnd_start_hour: '22:00', dnd_end_hour: '8:00',
    })
  })
})

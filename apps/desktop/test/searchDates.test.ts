// The Search Date menu's presets are days of the Slack profile's calendar, not the Mac's (SPEC 10a): near midnight
// the two disagree on today, this week and this month. Weeks start on Monday.
import { expect, it } from 'bun:test'
import { dateChip, type DatePreset } from '../src/renderer/containers/search/chips'

it.each([
  // 19:00 UTC on Saturday 24 October: Los Angeles is still on the 24th, Kolkata already on Sunday the 25th.
  ['2026-10-24T19:00:00Z', 'America/Los_Angeles', 'today', 'on:2026-10-24'],
  ['2026-10-24T19:00:00Z', 'Asia/Kolkata', 'today', 'on:2026-10-25'],
  ['2026-10-24T19:00:00Z', 'America/Los_Angeles', 'yesterday', 'on:2026-10-23'],
  ['2026-10-24T19:00:00Z', 'Asia/Kolkata', 'this-week', 'after:2026-10-18'],
  // 01:00 UTC on Monday 26 October: Los Angeles is still on Sunday the 25th, Kolkata on Monday, a new week.
  ['2026-10-26T01:00:00Z', 'America/Los_Angeles', 'this-week', 'after:2026-10-18'],
  ['2026-10-26T01:00:00Z', 'Asia/Kolkata', 'this-week', 'after:2026-10-25'],
  ['2026-10-26T01:00:00Z', 'Asia/Kolkata', 'last-week', 'after:2026-10-18 before:2026-10-26'],
  // The last evening of October in Los Angeles is November in Kolkata.
  ['2026-10-31T20:00:00Z', 'America/Los_Angeles', 'this-month', 'during:2026-10'],
  ['2026-10-31T20:00:00Z', 'Asia/Kolkata', 'this-month', 'during:2026-11'],
] satisfies ReadonlyArray<readonly [string, string, DatePreset, string]>)('at %s in %s, %s is %s', (now, timeZone, preset, token) => {
  expect(dateChip(preset, timeZone, new Date(now)).token).toBe(token)
})

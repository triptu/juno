import { expect, it } from 'vitest'
import { wakeSchedule } from '../src/send/nextWake'

it('counts only channel heads and the timers that can unblock work', () => {
  const wake = wakeSchedule()
  const rows = [{ id: 1, channel: 'A', nextAt: 1000 }, { id: 2, channel: 'A', nextAt: 0 }, { id: 3, channel: 'B', nextAt: 700 }]
  expect(wake(rows, 100).delay).toBe(600)
  expect(wake(rows, 100, new Set([3]), [500]).delay).toBe(400)
  expect(wake(rows, 100, new Set([1, 3])).delay).toBeUndefined()
})

it('never returns zero twice for the same unchanged head, and reports the incident once', () => {
  const wake = wakeSchedule()
  const rows = [{ id: 1, channel: 'A', nextAt: 0 }]
  expect(wake(rows, 100)).toEqual({ delay: 0, repeatedHead: undefined })
  expect(wake(rows, 101)).toEqual({ delay: 50, repeatedHead: 1 })
  expect(wake(rows, 151)).toEqual({ delay: 50, repeatedHead: undefined })
  expect(wake([{ ...rows[0]!, id: 2 }], 152).delay).toBe(0)
})

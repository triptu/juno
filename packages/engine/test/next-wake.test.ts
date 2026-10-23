import { expect, it } from 'bun:test'
import { wakeSchedule } from '../src/send/nextWake'

it('counts only channel heads and the timers that can unblock work', () => {
  const wake = wakeSchedule()
  const rows = [{ id: 1, channel: 'A', nextAt: 1000 }, { id: 2, channel: 'A', nextAt: 0 }, { id: 3, channel: 'B', nextAt: 700 }]
  expect(wake(rows, 100).delay).toBe(600)
  expect(wake(rows, 100, new Set([3]), [500]).delay).toBe(400)
  expect(wake(rows, 100, new Set([1, 3])).delay).toBeUndefined()
})

it('never returns zero twice for the same head, and reports the incident once', () => {
  const wake = wakeSchedule()
  const rows = [{ id: 1, channel: 'A', nextAt: 0 }]
  expect(wake(rows, 100)).toEqual({ delay: 0, repeatedHead: undefined })
  expect(wake(rows, 101)).toEqual({ delay: 50, repeatedHead: 1 })
  expect(wake([{ ...rows[0]!, nextAt: 150 }], 151)).toEqual({ delay: 50, repeatedHead: undefined })
  expect(wake([{ ...rows[0]!, id: 2 }], 152).delay).toBe(0)
})

it('wakes unrelated reactions but keeps the keys of a blocked edit reserved', () => {
  const rows = [
    { id: 1, channel: 'A', keys: ['A', 'message:1'], nextAt: 1000 },
    { id: 2, channel: 'A', keys: ['A', 'message:2'], nextAt: 0 },
    { id: 3, channel: 'A', keys: ['message:2'], nextAt: 0 },
  ]
  const wake = wakeSchedule<(typeof rows)[number]>((row) => row.keys)
  expect(wake(rows, 100).delay).toBe(900)
  expect(wake([...rows, { id: 4, channel: 'A', keys: ['message:3'], nextAt: 0 }], 100).delay).toBe(0)
})

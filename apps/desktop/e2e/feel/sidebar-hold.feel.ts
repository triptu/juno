// The sidebar's order hold (SPEC 5, "Holding the order"): while the pointer
// is over the topic list, replies elsewhere update their rows in place and
// no row moves; leaving the list applies the new order in one step.
import { expect } from '../fixtures'
import { pointAt } from '../driver/juno'
import { happened, landsAndStays, noFlicker, noLayoutShift, shotOfFrame, type Check } from './checks'
import { test } from './feel'
import type { ProbeFrame } from './recorder'

const RECENT_ROWS = 'aside[aria-label="Sidebar"] [role="group"][aria-label="Topics"] [data-topic-row]'

const order = (values: ProbeFrame['values']): string => {
  const rows = values['rows']
  return Array.isArray(rows) ? rows.map((row) => row.key).join(' ') : 'no rows'
}

/** After the pointer leaves, the list goes from the held order to the new one in one frame, with nothing in between. */
const reordersOnce: Check = (evidence) => {
  const name = 'the new order lands in one step'
  const leave = evidence.recording.marks.find((mark) => mark.label === 'leave')
  if (leave === undefined) return { name, status: 'fail', detail: 'no leave mark', shots: [] }
  const frames = evidence.recording.frames.slice(leave.nextFrame)
  const states = frames.map((frame) => order(frame.values))
  const held = states[0]
  const last = states.at(-1)
  const between = frames.filter((_, i) => states[i] !== held && states[i] !== last)
  const changes = states.filter((state, i) => i > 0 && state !== states[i - 1]).length
  if (held === last) return { name, status: 'fail', detail: 'the order never changed after the pointer left', shots: [] }
  if (between.length === 0 && changes === 1) return { name, status: 'pass', detail: `one change, at #${shotOfFrame(evidence, frames[states.indexOf(last!)]!.index)}`, shots: [shotOfFrame(evidence, frames[states.indexOf(last!)]!.index)] }
  return { name, status: 'fail', detail: `${changes} order changes, ${between.length} frames in another order`, shots: [...new Set(between.map((frame) => shotOfFrame(evidence, frame.index)))].slice(0, 12) }
}

test('the sidebar holds its order under the pointer while replies land, and reorders once when the pointer leaves', async ({ juno, win, fake, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  const recent = juno.sidebar.section('Recent').locator('[data-topic-row]')
  const ids = await recent.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-topic-id') ?? ''))
  // The two oldest threads in Recent, below the row pointed at: replies in them would move them to the top.
  const threads = ids.slice(2).filter((id) => id.startsWith('t:')).slice(-2)
  expect(threads).toHaveLength(2)
  const target = juno.sidebar.list.locator(`[data-topic-id="${ids[1]}"]`)
  await pointAt(win, target, { x: 40, y: 20 })
  await win.waitForTimeout(300)

  await feel.run(
    {
      name: 'sidebar-hold',
      title: 'Point at a sidebar row while two replies land elsewhere: no row moves under the pointer; leaving applies the new order in one step',
      probes: [
        { kind: 'boxes', name: 'rows', selector: RECENT_ROWS, key: 'data-topic-id' },
        { kind: 'rect', name: 'target', selector: `[data-topic-id="${ids[1]}"]` },
        { kind: 'count', name: 'replies', within: 'aside[aria-label="Sidebar"]', selector: threads.map((id) => `[data-topic-id="${id}"]`).join(', ') },
        { kind: 'text', name: 'moved', selector: threads.map((id) => `[data-topic-id="${id}"]`).join(', ') },
      ],
      regions: { sidebar: 'aside[aria-label="Sidebar"]' },
      settleMs: 800,
      checks: [
        happened('the replies showed in their rows', (r) => r.frames.some((f) => String(f.values['moved']).includes('Held reply'))),
        landsAndStays('target', 'the row under the pointer', { to: 'leave' }),
        landsAndStays('rows', 'every row', { to: 'leave' }),
        noLayoutShift({ region: 'sidebar', to: 'leave', label: 'the held list holds still' }),
        reordersOnce,
        noFlicker('sidebar', 'the sidebar'),
      ],
    },
    async (rec) => {
      await rec.mark('replies')
      for (const [i, id] of threads.entries()) {
        const [, channel, threadTs] = id.split(':')
        fake.injectMessage({ channel: channel!, threadTs: threadTs!, user: 'U0LEO', text: `Held reply ${i}` })
      }
      for (const [i, id] of threads.entries()) await expect(juno.sidebar.list.locator(`[data-topic-id="${id}"]`)).toContainText(`Held reply ${i}`, { timeout: 15_000 })
      await win.waitForTimeout(400)
      await rec.mark('leave')
      await juno.sidebar.leave()
      await expect.poll(async () => {
        const now = await recent.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-topic-id') ?? ''))
        return now.indexOf(threads[1]!) >= 0 && now.indexOf(threads[1]!) < now.indexOf(ids[1]!)
      }).toBe(true)
    },
  )
})

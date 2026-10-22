// Rows moving at the top of the sidebar (SPEC 5, "Holding the order"): a
// reply from someone else moves a thread to the top of Recent, a newly
// followed thread comes in at the top, and three replies land within half a
// second. With the list at its top and the pointer away, the rows slide to
// their places; every one ends where the new order puts it.
import type { Page } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from '../driver/juno'
import { happened, noFlicker, noLongFrames, shotOfFrame, type Check } from './checks'
import { expect, test } from './feel'
import type { ProbeFrame } from './recorder'

const ROWS = 'aside[aria-label="Sidebar"] [role="group"][aria-label="Topics"] [data-topic-row]'

interface Box {
  readonly key: string
  readonly y: number
  readonly height: number
}

const boxes = (values: ProbeFrame['values']): ReadonlyArray<Box> => {
  const rows = values['rows']
  return Array.isArray(rows) ? (rows as ReadonlyArray<Box>) : []
}

/**
 * The rows that changed place go there over several frames, each step in
 * one direction, and the last frame has every row at its layout place: the
 * DOM order, top to bottom, with no gap or overlap.
 */
function slidesIntoPlace(from: string): Check {
  return (evidence) => {
    const name = 'rows slide to their new places and end in order'
    const mark = evidence.recording.marks.find((m) => m.label === from)
    if (mark === undefined) return { name, status: 'fail', detail: `no ${from} mark`, shots: [] }
    const frames = evidence.recording.frames.slice(mark.nextFrame)
    const first = boxes(frames[0]?.values ?? {})
    const last = boxes(frames.at(-1)?.values ?? {})
    const start = new Map(first.map((box) => [box.key, box.y]))
    const end = new Map(last.map((box) => [box.key, box.y]))
    // Frames in which some row was between where it was and where it ends.
    const between = frames.filter((frame) =>
      boxes(frame.values).some((box) => {
        const a = start.get(box.key)
        const b = end.get(box.key)
        if (a === undefined || b === undefined || Math.abs(a - b) < 1) return false
        return Math.min(a, b) + 1 < box.y && box.y < Math.max(a, b) - 1
      }),
    )
    const sorted = [...last].sort((a, b) => a.y - b.y).map((box) => box.key)
    const inOrder = sorted.every((key, i) => key === last[i]?.key)
    const overlaps = last.slice(1).filter((box, i) => box.y < last[i]!.y + last[i]!.height - 0.5).length
    const shots = [...new Set(between.map((frame) => shotOfFrame(evidence, frame.index)))]
    if (between.length >= 3 && inOrder && overlaps === 0) return { name, status: 'pass', detail: `${between.length} frames in motion, then every row at its place`, shots: shots.slice(0, 12) }
    return { name, status: 'fail', detail: `${between.length} frames in motion; last frame ${inOrder ? 'in order' : 'out of order'}, ${overlaps} overlaps`, shots: shots.slice(0, 12) }
  }
}

async function recentIds(juno: Juno): Promise<string[]> {
  return juno.sidebar.section('Recent').locator('[data-topic-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-topic-id') ?? ''))
}

function reply(fake: FakeSlack, id: string, text: string): void {
  const [, channel, threadTs] = id.split(':')
  fake.injectMessage({ channel: channel!, threadTs: threadTs!, user: 'U0LEO', text })
}

/** Signs in, picks the theme, and parks the pointer away from the list at its top. */
async function ready(juno: Juno, win: Page, theme: 'Light' | 'Dark'): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  if (theme === 'Dark') await juno.setTheme('Dark')
  await win.mouse.move(900, 400)
  await win.waitForTimeout(400)
}

const probes = [{ kind: 'boxes', name: 'rows', selector: ROWS, key: 'data-topic-id' }] as const
const regions = { sidebar: 'aside[aria-label="Sidebar"]' }

// `FEEL_THEMES=Light,Dark` records each scenario in both themes.
const themes = (process.env['FEEL_THEMES'] ?? 'Light').split(',') as Array<'Light' | 'Dark'>

for (const theme of themes) {
  const tag = theme.toLowerCase()

  test(`sidebar motion (${tag}): a reply moves a thread from lower in the list to the top`, async ({ juno, win, fake, feel }) => {
    await ready(juno, win, theme)
    const ids = await recentIds(juno)
    // A thread in view, a few rows down.
    const mover = ids.slice(3, 8).find((id) => id.startsWith('t:'))
    expect(mover).toBeDefined()
    await feel.run(
      {
        name: `sidebar-move-up-${tag}`,
        title: 'A reply from someone else moves a thread from lower in the list to the top; the rows between slide down as it slides up',
        probes,
        regions,
        settleMs: 700,
        checks: [happened('the thread moved up', (r) => {
            const y = (frame: ProbeFrame | undefined) => boxes(frame?.values ?? {}).find((box) => box.key === mover)?.y ?? Number.NaN
            return y(r.frames.at(-1)) < y(r.frames[0])
          }), slidesIntoPlace('reply'), noFlicker('sidebar', 'the sidebar'), noLongFrames()],
      },
      async (rec) => {
        await rec.mark('reply')
        reply(fake, mover!, 'Moved up by a reply')
        await expect.poll(async () => (await recentIds(juno))[0]).toBe(mover)
      },
    )
  })

  test(`sidebar motion (${tag}): a newly followed thread comes in at the top`, async ({ juno, win, fake, feel }) => {
    await ready(juno, win, theme)
    // A new thread in #platform, outside the sidebar until it is followed.
    const root = fake.injectMessage({ channel: 'C0PLATFORM', user: 'U0SAM', text: 'Should we move the build cache to the new runners?' })
    await win.waitForTimeout(1_200)
    const id = `t:C0PLATFORM:${root.ts}`
    await feel.run(
      {
        name: `sidebar-new-topic-${tag}`,
        title: 'A thread followed in another client, with a reply, comes in at the top of Recent; the rows below slide down',
        probes,
        regions,
        settleMs: 700,
        checks: [happened('the thread came in', (r) => boxes(r.frames.at(-1)?.values ?? {}).some((box) => box.key === id)), slidesIntoPlace('follow'), noFlicker('sidebar', 'the sidebar'), noLongFrames()],
      },
      async (rec) => {
        await rec.mark('follow')
        fake.followThread({ channel: 'C0PLATFORM', threadTs: root.ts })
        fake.injectMessage({ channel: 'C0PLATFORM', threadTs: root.ts, user: 'U0LEO', text: 'Yes, they have the disk for it.' })
        await expect.poll(async () => (await recentIds(juno)).includes(id), { timeout: 15_000 }).toBe(true)
      },
    )
  })

  test(`sidebar motion (${tag}): three replies within half a second`, async ({ juno, win, fake, feel }) => {
    await ready(juno, win, theme)
    const ids = await recentIds(juno)
    const movers = ids.slice(2).filter((id) => id.startsWith('t:')).slice(0, 3)
    expect(movers).toHaveLength(3)
    await feel.run(
      {
        name: `sidebar-burst-${tag}`,
        title: 'Three replies from someone else land 200 ms apart; the rows retarget from where they are drawn and settle in the final order',
        probes,
        regions,
        settleMs: 800,
        checks: [slidesIntoPlace('burst'), noFlicker('sidebar', 'the sidebar'), noLongFrames()],
      },
      async (rec) => {
        await rec.mark('burst')
        for (const [i, id] of movers.entries()) {
          reply(fake, id, `Burst reply ${i + 1}`)
          await win.waitForTimeout(200)
        }
        await expect.poll(async () => (await recentIds(juno)).slice(0, 3)).toEqual([...movers].reverse())
      },
    )
  })
}

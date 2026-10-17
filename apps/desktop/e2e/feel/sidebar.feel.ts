import { happened, noLayoutShift, shotOfFrame, type Check } from './checks'
import { expect, test } from './feel'

/** The fake's bot channels, which the rules move to Automated (SPEC 5, "Automated"). */
const BOT_CHANNELS = ['C0ALERTSPROD', 'C0DEPLOYS']

/**
 * A row All painted stays in All and never moves up for the rest of the
 * first sync. A row that leaves, or one above it leaving, moves the rows
 * below it up under the pointer. A row added above may push rows down, as
 * conversations land.
 */
const paintedRowsHold: Check = (evidence) => {
  const painted = new Map<string, number>()
  const seen = new Set<string>()
  const bad: number[] = []
  let pushedDown = 0
  for (const frame of evidence.recording.frames) {
    const items = frame.values['rows']
    if (typeof items !== 'object' || items === null || !('length' in items)) continue
    const now = new Map(items.map((item) => [item.key, item.y]))
    for (const [key, y] of painted) {
      const next = now.get(key)
      // Each loss or lift is named once, at the frame it happened.
      if (next === undefined) painted.delete(key)
      if (next === undefined || next < y - 0.5) bad.push(frame.index)
      else if (next > y + 0.5) pushedDown += 1
    }
    for (const [key, y] of now) {
      painted.set(key, y)
      seen.add(key)
    }
  }
  return {
    name: 'a painted row stays in All and never moves up',
    status: seen.size > 0 && bad.length === 0 ? 'pass' : 'fail',
    detail: `${seen.size} rows checked; ${new Set(bad).size} frames lost a painted row or moved one up; ${pushedDown} row moves down from rows added above`,
    shots: [...new Set(bad)].slice(0, 12).map((frame) => shotOfFrame(evidence, frame)),
  }
}

/** The rules move the bot channels to Automated before All shows them, so no frame has one. */
const botsStayOut: Check = (evidence) => {
  const shown = evidence.recording.frames.filter((frame) => Number(frame.values['bots']) > 0).map((frame) => frame.index)
  return {
    name: 'a bot channel never shows in All',
    status: shown.length === 0 ? 'pass' : 'fail',
    detail: `${shown.length} frames showed a row of ${BOT_CHANNELS.join(' or ')} in All`,
    shots: [...new Set(shown.map((frame) => shotOfFrame(evidence, frame)))].slice(0, 12),
  }
}

test('the sidebar fills during the first sync without dropping or lifting a painted row', async ({ juno, win, fake, feel }) => {
  const method = 'conversations.history'
  const subscriptions = 'subscriptions.thread.getView'
  // The quick start waits for the first page of followed threads, so the recording starts before All has a row.
  fake.holdNext({ method: subscriptions })
  fake.holdNext({ method })
  await juno.signIn()
  await expect.poll(() => fake.heldCount({ method: subscriptions })).toBe(1)
  const sidebar = win.locator('aside[aria-label="Sidebar"]')
  const rows = sidebar.locator('[data-topic-row]')
  // The pointer away from the list, so the order hold does not apply.
  await win.mouse.move(900, 400)
  await feel.run({
    name: 'sidebar-first-sync',
    title: 'Watch the sidebar during the first sync; bot channels never show in All, and painted rows never leave or move up',
    regions: { sidebar: 'aside[aria-label="Sidebar"]' },
    probes: [
      { kind: 'boxes', name: 'rows', selector: 'aside[aria-label="Sidebar"] [data-topic-row]', key: 'data-topic-id' },
      { kind: 'count', name: 'bots', within: 'aside[aria-label="Sidebar"]', selector: BOT_CHANNELS.map((id) => `[data-topic-id*="${id}"]`).join(', ') },
      { kind: 'count', name: 'busy', within: 'body', selector: 'aside[aria-label="Sidebar"][aria-busy="true"]' },
    ],
    checks: [
      happened('All was empty when the recording started', (r) => {
        const first = r.frames[0]?.values['rows']
        return Array.isArray(first) && first.length === 0
      }),
      happened('rows showed while the first sync ran', (r) => r.frames.some((f) => Array.isArray(f.values['rows']) && f.values['rows'].length > 0 && f.values['busy'] === 1)),
      happened('the first sync finished with rows in All', (r) => {
        const last = r.frames.at(-1)?.values
        return last !== undefined && Array.isArray(last['rows']) && last['rows'].length > 0 && last['busy'] === 0
      }),
      botsStayOut,
      paintedRowsHold,
      // Rows that land above painted ones push them down as the first sync fills All (SPEC 5); that is a warning here.
      // What this scenario guards is a row leaving, which `paintedRowsHold` fails on.
      noLayoutShift({ region: 'sidebar', from: 'history pages', warn: true }),
    ],
  }, async (rec) => {
    await rec.mark('quick start')
    fake.release({ method: subscriptions })
    await expect(rows.first()).toBeVisible({ timeout: 30_000 })
    await rec.mark('history pages')
    // One history page at a time, a few frames apart, well inside the five-second hold.
    const deadline = Date.now() + 30_000
    while (await sidebar.getAttribute('aria-busy') === 'true' && Date.now() < deadline) {
      if (fake.heldCount({ method }) > 0) {
        fake.release({ method })
        fake.holdNext({ method })
      }
      await win.waitForTimeout(120)
    }
    fake.release({ method })
    await expect(sidebar).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
    await expect(rows.first()).toBeVisible()
  })
})

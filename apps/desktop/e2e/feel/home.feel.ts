import { happened, landsAndStays, noLayoutShift, shotOfFrame, switchesOnce, type Check } from './checks'
import { expect, test } from './feel'

test('Home has its data when it replaces the topic after its subscription expires', async ({ juno, win, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.home.open()
  await expect(juno.home.item('waiting')).toBeVisible()
  await juno.sidebar.row('Draft plan is in the doc').open()
  await juno.topic.expectTitle('Draft plan is in the doc')
  await win.waitForTimeout(31_000)

  await feel.run({
    name: 'home-after-idle',
    title: 'Open Home after reading a topic: its data is ready before the entrance animation starts',
    probes: [
      { kind: 'count', within: 'main', name: 'topic', selector: '[data-topic-view]' },
      { kind: 'count', within: 'main', name: 'home', selector: '[data-home-item]' },
      { kind: 'count', within: 'main', name: 'waiting', selector: '[data-home-waiting]' },
    ],
    checks: [
      happened('Home showed its rows', (r) => r.frames.some((f) => Number(f.values['home']) > 0)),
      happened('no loading placeholder between pages', (r) => r.frames.every((f) => Number(f.values['waiting']) === 0 && (Number(f.values['topic']) > 0 || Number(f.values['home']) > 0))),
      switchesOnce('topic to Home', (v) => Number(v['home']) > 0 ? 'home' : Number(v['topic']) > 0 ? 'topic' : 'empty'),
    ],
  }, async (rec) => {
    await rec.mark('press')
    await juno.home.open()
    await expect(juno.home.item('waiting')).toBeVisible()
  })
})

const rowsStayInSlots: Check = (evidence) => {
  const painted = new Map<string, string>()
  const bad: number[] = []
  for (const frame of evidence.recording.frames) {
    const items = frame.values['items']
    if (typeof items !== 'object' || items === null || !('length' in items)) continue
    const slots = frame.values['slots']
    if (items.length > 0 && (typeof slots !== 'object' || slots === null || !('width' in slots)
      || items[0]?.y !== slots.y
      || items.some((item) => item.y < slots.y || item.y + item.height > slots.y + slots.height))) bad.push(frame.index)
    for (const [key, box] of painted) {
      if (JSON.stringify(items.find((item) => item.key === key)) !== box) bad.push(frame.index)
    }
    for (const item of items) painted.set(item.key, JSON.stringify(item))
  }
  return {
    name: 'rows fill from the top and every painted row stays in its slot',
    status: painted.size > 0 && bad.length === 0 ? 'pass' : 'fail',
    detail: `${painted.size} rows checked; ${new Set(bad).size} frames violated a reserved slot or moved or removed a painted row`,
    shots: [...new Set(bad)].slice(0, 12).map((frame) => shotOfFrame(evidence, frame)),
  }
}

test('Home fills reserved slots during the first sync without moving painted content', async ({ juno, win, fake, feel }) => {
  const method = 'conversations.history'
  const replies = 'conversations.replies'
  const subscriptions = 'subscriptions.thread.getView'
  fake.holdNext({ method: subscriptions })
  fake.holdNext({ method })
  await juno.signIn()
  await expect.poll(() => fake.heldCount({ method: subscriptions })).toBe(1)
  const home = win.locator('[data-home]')
  const rows = home.locator('[data-home-item]')
  await feel.run({
    name: 'home-first-sync',
    title: 'Open Home during first sync; history pages fill reserved slots without moving painted content',
    regions: { home: '[data-home]' },
    probes: [
      { kind: 'text', name: 'greeting', selector: '[data-home] h2' },
      { kind: 'text', name: 'line', selector: '[data-home] h2 + p' },
      { kind: 'count', name: 'syncing', within: 'main', selector: '[data-home-loading]' },
      { kind: 'count', name: 'rows', within: '[data-home]', selector: '[data-home-item]' },
      { kind: 'rect', name: 'greetingBox', selector: '[data-home] h2' },
      { kind: 'rect', name: 'lineBox', selector: '[data-home] h2 + p' },
      { kind: 'rect', name: 'slots', selector: '[data-home] ul' },
      // Recent's room while its rows are on their way, then Recent: the same box.
      { kind: 'rect', name: 'recent', selector: '[data-home] :is([data-home-recent], [data-home-recent-reserved])' },
      { kind: 'rect', name: 'chip', selector: '[data-home-write] [aria-label^="Send to:"]' },
      { kind: 'rect', name: 'field', selector: '[data-home] [data-composer-field]' },
      { kind: 'boxes', name: 'items', selector: '[data-home-item]', key: 'data-home-item' },
    ],
    checks: [
      happened('first Home frame has its greeting, sync text and reserved slots', (r) => {
        const first = r.frames.find((f) => f.values['greetingBox'] !== null)
        return first !== undefined && typeof first.values['greeting'] === 'string' && first.values['greeting'].length > 0
          && first.values['line'] === 'Syncing with Slack.' && first.values['slots'] !== null
          && first.values['rows'] === 0 && first.values['syncing'] === 1
      }),
      happened('rows arrive while sync is still running', (r) => r.frames.some((f) => Number(f.values['rows']) > 0 && f.values['syncing'] === 1)),
      happened('sync completes with rows still painted', (r) => Number(r.frames.at(-1)?.values['rows']) > 0 && r.frames.at(-1)?.values['syncing'] === 0),
      landsAndStays('lineBox', 'sync text', { tolerance: 0, where: (v) => v['syncing'] === 1 }),
      ...['greetingBox', 'slots', 'recent', 'chip', 'field'].map((probe) => landsAndStays(probe, probe, { tolerance: 0 })),
      noLayoutShift({ region: 'home', includeInput: true, from: 'history pages' }),
      rowsStayInSlots,
    ],
  }, async (rec) => {
    await rec.mark('open')
    await juno.home.navItem.click()
    await expect(home).toHaveAttribute('data-home-loading', '')
    await expect(rows).toHaveCount(0)
    await rec.mark('history pages')
    fake.release({ method: subscriptions })
    await expect.poll(async () => {
      if (await rows.count() > 0) return true
      if (fake.heldCount({ method }) > 0) {
        fake.release({ method })
        fake.holdNext({ method })
      }
      return false
    }, { timeout: 30_000 }).toBe(true)
    await expect.poll(() => fake.heldCount({ method })).toBe(1)
    fake.holdNext({ method: replies, times: 1000 })
    await rec.mark('remaining history')
    fake.release({ method })
    await expect.poll(() => fake.heldCount({ method: replies }), { timeout: 30_000 }).toBeGreaterThan(0)
    await expect(home).toHaveAttribute('data-home-loading', '')
    await rec.mark('finish sync')
    fake.release({ method: replies })
    await expect(home).not.toHaveAttribute('data-home-loading', { timeout: 30_000 })
  })
})

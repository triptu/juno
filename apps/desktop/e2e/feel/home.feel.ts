import { pointAt, press } from '../driver/juno'
import { feedbackInOneFrame, happened, landsAndStays, noFlicker, switchesOnce } from './checks'
import { expect, test } from './feel'
import { tag } from './pane'

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
    title: 'Open Home after reading a topic: it replaces the topic with its rows, with no loading frame between',
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

test('Home shows rows as the first sync lands them, with the composer still and no flicker', async ({ juno, win, fake, feel }) => {
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
    title: 'Open Home during the first sync: rows show as history pages land, no space is kept for them, and the composer never moves',
    regions: { home: '[data-home]' },
    probes: [
      { kind: 'text', name: 'greeting', selector: '[data-home] h2' },
      { kind: 'text', name: 'line', selector: '[data-home] h2 + p' },
      { kind: 'count', name: 'syncing', within: 'main', selector: '[data-home-loading]' },
      { kind: 'count', name: 'rows', within: '[data-home]', selector: '[data-home-item]' },
      { kind: 'rect', name: 'greetingBox', selector: '[data-home] h2' },
      { kind: 'rect', name: 'chip', selector: '[data-home-write] [aria-label^="Send to:"]' },
      { kind: 'rect', name: 'field', selector: '[data-home] [data-composer-field]' },
    ],
    checks: [
      happened('first Home frame has its greeting and sync text, and no rows', (r) => {
        const first = r.frames.find((f) => f.values['greetingBox'] !== null)
        return first !== undefined && typeof first.values['greeting'] === 'string' && first.values['greeting'].length > 0
          // "Syncing with Slack." while the conversations are listed, then the first sync's count (SPEC 12).
          && /^Syncing (with Slack|\d+ of \d+ conversations)\.$/.test(String(first.values['line']))
          && first.values['rows'] === 0 && first.values['syncing'] === 1
      }),
      happened('rows arrive while sync is still running', (r) => r.frames.some((f) => Number(f.values['rows']) > 0 && f.values['syncing'] === 1)),
      happened('sync completes with rows still painted', (r) => Number(r.frames.at(-1)?.values['rows']) > 0 && r.frames.at(-1)?.values['syncing'] === 0),
      ...['chip', 'field'].map((probe) => landsAndStays(probe, probe, { tolerance: 0 })),
      noFlicker('home', 'Home'),
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
    // Home may be ready by now, with the sync still running (owner, 10-18): the probes above cover that step too.
    await expect(juno.sidebar.syncStatus).toBeVisible()
    await rec.mark('finish sync')
    fake.release({ method: replies })
    await expect(home).not.toHaveAttribute('data-home-loading', { timeout: 30_000 })
  })
})

test("the title bar's Home icon shows its press at once and replaces the topic with Home once", async ({ juno, win, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('Draft plan is in the doc').open()
  await juno.topic.expectTitle('Draft plan is in the doc')
  const icon = await tag(juno.home.navItem, 'home-icon')
  await pointAt(win, juno.home.navItem)
  await win.waitForTimeout(300)

  await feel.run({
    name: 'home-icon',
    title: "Press the Home icon in the sidebar's title bar from a topic: the press shows in the next frame, and Home replaces the topic in one step",
    probes: [
      { kind: 'look', name: 'look', selector: icon },
      { kind: 'count', within: 'main', name: 'topic', selector: '[data-topic-view]' },
      { kind: 'count', within: 'main', name: 'home', selector: '[data-home-item]' },
      { kind: 'count', within: 'main', name: 'waiting', selector: '[data-home-waiting], [data-home-loading]' },
      { kind: 'box', name: 'field', selector: '[data-home] [data-composer-field]' },
    ],
    regions: { main: 'main' },
    checks: [
      feedbackInOneFrame('look', 'pointerdown', 'the icon press', { from: 'press' }),
      happened('Home showed its rows', (r) => r.frames.some((f) => Number(f.values['home']) > 0)),
      switchesOnce('topic to Home', (v) => (Number(v['home']) > 0 && Number(v['waiting']) === 0 ? 'home' : Number(v['topic']) > 0 ? 'topic' : 'empty')),
      landsAndStays('field', "Home's field", { tolerance: 0 }),
      noFlicker('main', 'the page'),
    ],
  }, async (rec) => {
    await rec.mark('press')
    await press(win)
    await expect(juno.home.item('waiting')).toBeVisible()
  })
})

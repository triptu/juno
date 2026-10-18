import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { test as base, expect, launchApp } from './fixtures'
import { Juno } from './driver/juno'
import { expectStableAnchor } from './shiftProbe'

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: largeSeed({ topics: 1_200, messages: 12_000, users: 400, channels: { public: 60, private: 20, dms: 30, mpims: 10 } }) })
    await use(fake)
    await fake.close()
  },
})

test('topic title lines apply immediately, keep the scrolled row anchored, and survive relaunch', async ({ juno, win, running, fake, slackApp, userData }) => {
  test.setTimeout(180_000)
  await juno.signIn()
  await juno.waitForSync()
  const firstTitle = await juno.sidebar.rows.first().locator('[data-row-part="title"]').innerText()
  await juno.sidebar.row(firstTitle, { exact: true }).chooseInMenu('rename')
  await juno.rename('Plan')
  await juno.openSettings('Appearance')
  const one = win.getByRole('radio', { name: 'One line', exact: true })
  const two = win.getByRole('radio', { name: 'Two lines', exact: true })
  await expect(one).toHaveAttribute('aria-checked', 'true')
  const before = await juno.sidebar.rows.evaluateAll((rows) => rows.slice(0, 8).map((row) => ({ id: row.getAttribute('data-topic-id'), height: row.getBoundingClientRect().height })))
  await two.click()
  await expect(win.locator('html')).toHaveAttribute('data-topic-title-lines', 'two')
  const after = await juno.sidebar.rows.evaluateAll((rows) => rows.slice(0, 8).map((row) => {
    const title = row.querySelector<HTMLElement>('[data-row-part="title"]')!
    return { id: row.getAttribute('data-topic-id'), height: row.getBoundingClientRect().height, lines: title.clientHeight / parseFloat(getComputedStyle(title).lineHeight) }
  }))
  expect(after.some((row) => row.lines === 2)).toBe(true)
  expect(after.some((row) => row.lines === 1)).toBe(true)
  for (const row of after) {
    const old = before.find((other) => other.id === row.id)!
    if (row.lines === 1) expect(row.height).toBe(old.height)
    else expect(row.height).toBeGreaterThan(old.height)
  }
  const list = juno.sidebar.list
  const box = (await list.boundingBox())!
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 12; i++) {
    await win.mouse.wheel(0, 200)
    await win.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  }
  const anchor = await list.evaluate((node) => {
    const top = node.getBoundingClientRect().top
    const row = Array.from(node.querySelectorAll<HTMLElement>('[data-topic-row]')).find((row) => row.getBoundingClientRect().bottom > top)!
    return { id: row.dataset['topicId']!, top: row.getBoundingClientRect().top }
  })
  const held = list.locator(`[data-topic-id="${anchor.id}"]`)
  await expectStableAnchor(win, `[data-topic-id="${anchor.id}"]`, () => one.click())
  await expect.poll(async () => (await held.boundingBox())!.y).toBe(anchor.top)
  await expectStableAnchor(win, `[data-topic-id="${anchor.id}"]`, () => two.click())
  await expect.poll(async () => (await held.boundingBox())!.y).toBe(anchor.top)
  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const second = new Juno(again.app, again.win)
    await second.sidebar.expectRows()
    await expect(again.win.locator('html')).toHaveAttribute('data-topic-title-lines', 'two')
    await second.openSettings('Appearance')
    await expect(again.win.getByRole('radio', { name: 'Two lines', exact: true })).toHaveAttribute('aria-checked', 'true')
  } finally {
    await again.close()
  }
})

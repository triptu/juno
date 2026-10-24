import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { test as base, expect } from './fixtures'
import { expectStableAnchor } from './shiftProbe'

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: largeSeed({ topics: 320, messages: 3_200, users: 40, channels: { public: 8, private: 2, dms: 6, mpims: 2 } }) })
    await use(fake)
    await fake.close()
  },
})

test('topic title lines apply immediately, keep the scrolled row anchored, and survive relaunch', async ({ juno, win, relaunch }) => {
  test.setTimeout(180_000)
  await juno.signIn()
  await juno.waitForSync()
  const firstTitle = await juno.sidebar.list.locator('[data-topic-row][data-topic-id^="t:"]').first().locator('[data-row-part="title"]').innerText()
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
  expect(await list.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(2_400)
  const box = (await list.boundingBox())!
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.evaluate(() => {
    const values: number[] = []
    const observer = new PerformanceObserver((entries) => values.push(...entries.getEntries().map((entry) => (entry as PerformanceEntry & { value: number }).value)))
    observer.observe({ type: 'layout-shift' })
    Object.assign(window, { titleScrollShifts: { observer, values } })
  })
  for (let i = 0; i < 12; i++) {
    await win.mouse.wheel(0, 200)
    await win.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  }
  const shifts = await win.evaluate(() => {
    const state = window as unknown as { titleScrollShifts?: { observer: PerformanceObserver; values: number[] } }
    const probe = state.titleScrollShifts!
    probe.values.push(...probe.observer.takeRecords().map((entry) => (entry as PerformanceEntry & { value: number }).value))
    probe.observer.disconnect()
    delete state.titleScrollShifts
    return probe.values
  })
  expect(shifts, 'scrolling wrapped titles causes no layout shift, including during recent input').toEqual([])
  const anchor = await list.evaluate((node) => {
    const top = node.getBoundingClientRect().top
    const row = Array.from(node.querySelectorAll<HTMLElement>('[data-topic-row]')).find((candidate) => candidate.getBoundingClientRect().bottom > top)!
    return { id: row.dataset['topicId']!, top: row.getBoundingClientRect().top }
  })
  const held = list.locator(`[data-topic-id="${anchor.id}"]`)
  await expectStableAnchor(win, `[data-topic-id="${anchor.id}"]`, () => one.click())
  await expect.poll(async () => (await held.boundingBox())!.y).toBe(anchor.top)
  await expectStableAnchor(win, `[data-topic-id="${anchor.id}"]`, () => two.click())
  await expect.poll(async () => (await held.boundingBox())!.y).toBe(anchor.top)
  const second = await relaunch()
  await second.sidebar.expectRows()
  await expect(second.win.locator('html')).toHaveAttribute('data-topic-title-lines', 'two')
  await second.openSettings('Appearance')
  await expect(second.win.getByRole('radio', { name: 'Two lines', exact: true })).toHaveAttribute('aria-checked', 'true')
})

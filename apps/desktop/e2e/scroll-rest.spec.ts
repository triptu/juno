import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import type { Slack } from './driver/slack'
import { expect, test } from './fixtures'
import { expectRestSurvivesGrowth } from './scrollGrowthProbe'

async function openLongMain(juno: Juno, fake: FakeSlack, slack: Slack): Promise<string> {
  const channel = slack.channel('eng')
  for (let i = 0; i < 30; i++) fake.workspace.post({ channel, user: slack.as(i % 2 === 0 ? 'Maya' : 'Leo').id, text: `Earlier message ${i}`, silent: true })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectMessage('Earlier message 29')
  await juno.topic.toLatest()
  expect(await juno.topic.scroller.evaluate((node) => node.scrollHeight > node.clientHeight * 1.5)).toBe(true)
  return channel
}

test('the bottom survives shrinking content and fractional offsets at 2x', async ({ juno, win, slack, fake }) => {
  await openLongMain(juno, fake, slack)
  const zoom = 2 / await win.evaluate(() => devicePixelRatio)
  await juno.app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(zoom), zoom)
  expect(await win.evaluate(() => devicePixelRatio)).toBe(2)
  const result = await juno.topic.scroller.evaluate(async (node) => {
    const row = [...node.querySelectorAll<HTMLElement>('[data-message-row]')].at(-1)!
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    row.style.paddingBottom = '160px'
    await frame()
    await frame()
    node.scrollTop = Math.floor(node.scrollTop) - 0.5
    const fractional = node.scrollTop % 1
    row.style.paddingBottom = '80px'
    await frame()
    await frame()
    const shrunk = node.scrollHeight - node.scrollTop - node.clientHeight
    row.style.paddingBottom = '160px'
    await frame()
    await frame()
    const grown = node.scrollHeight - node.scrollTop - node.clientHeight
    row.style.paddingBottom = ''
    return { fractional, shrunk, grown }
  })
  expect(result.fractional).toBe(0.5)
  expect(result.shrunk).toBeLessThanOrEqual(1)
  expect(result.grown).toBeLessThanOrEqual(1)
})

test('a resting bottom survives growth during a coalesced scrollend', async ({ juno, slack, fake }) => {
  await openLongMain(juno, fake, slack)
  await expectRestSurvivesGrowth(juno.topic.scroller, '[data-message-row]')
})


test('a scroll down that stops just short of the end stays where it stopped', async ({ juno, slack, fake }) => {
  await openLongMain(juno, fake, slack)
  const { topic } = juno
  const distance = () => topic.scroller.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)
  await topic.scrollUp(24)
  const before = await distance()
  expect(before).toBeGreaterThan(9)
  expect(before).toBeLessThanOrEqual(32)
  // Part of the way back down from a script, as scrolling a row into view does. Resting within 32px held the bottom,
  // but no row grew, so the list stays where the scroll put it and the row under a still pointer stays there.
  await topic.scroller.evaluate(async (node) => {
    const ended = new Promise<void>((resolve) => node.addEventListener('scrollend', () => resolve(), { once: true }))
    node.scrollTop += 8
    await ended
    for (let i = 0; i < 5; i++) await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  expect(await distance()).toBe(before - 8)
})

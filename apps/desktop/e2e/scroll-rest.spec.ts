import { expect, test } from './fixtures'
import { expectRestSurvivesGrowth } from './scrollGrowthProbe'
import { openLongMain } from './stickBottomLists'

test('the bottom survives shrinking content and fractional offsets at 2x', { tag: '@electron' }, async ({ juno, win, slack, fake }) => {
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

test('a scroll that stops just short of the end stays put, and a resting bottom survives growth during a coalesced scrollend', async ({ juno, slack, fake }) => {
  await openLongMain(juno, fake, slack)
  const { topic } = juno
  await test.step('a scroll down that stops just short of the end stays where it stopped', async () => {
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
  // The probe scrolls to the end itself, so the step above does not change what it checks.
  await test.step('a resting bottom survives growth during a coalesced scrollend', () => expectRestSurvivesGrowth(topic.scroller, '[data-message-row]'))
})
